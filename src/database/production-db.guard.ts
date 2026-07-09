import * as fs from 'fs';
import * as path from 'path';

const REPO_LOCAL_DB_SUFFIX = `${path.sep}api.bestbond.in${path.sep}data.sqlite`;

/** Block known-bad production paths that create an empty "basic" dev database. */
const BLOCKED_DB_PATHS = new Set([
  'data.sqlite',
  '/var/lib/reward-system/data.sqlite',
  '/var/www/api.bestbond.in/data.sqlite',
]);

export type ProductionDatabaseSnapshot = {
  dbPath: string;
  sizeBytes: number;
  userCount: number;
  couponCount: number;
};

function countSqliteRows(
  dbPath: string,
  sql: string,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqlite3 = require('sqlite3') as typeof import('sqlite3');
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (openErr) => {
      if (openErr) {
        reject(openErr);
        return;
      }
      db.get(sql, (queryErr, row: { count?: number } | undefined) => {
        db.close();
        if (queryErr) reject(queryErr);
        else resolve(Number(row?.count ?? 0));
      });
    });
  });
}

function isBlockedProductionDbPath(dbPath: string): boolean {
  const normalized = path.resolve(dbPath);
  if (BLOCKED_DB_PATHS.has(dbPath) || BLOCKED_DB_PATHS.has(normalized)) {
    return true;
  }
  if (normalized.endsWith(REPO_LOCAL_DB_SUFFIX)) return true;
  return false;
}

/**
 * Refuses to start production with a repo-local or freshly-created "basic" SQLite file.
 * Set PROD_MIN_USER_COUNT=0 to skip the user-count check (first bootstrap only).
 */
export async function assertProductionDatabase(): Promise<ProductionDatabaseSnapshot> {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('assertProductionDatabase called outside production');
  }

  const dbPathRaw = process.env.DB_PATH?.trim();
  if (!dbPathRaw) {
    throw new Error(
      'DB_PATH must be set in production (.env.production). Use /home/bestbond/.local/share/reward-system/data.sqlite on the VPS.',
    );
  }

  const dbPath = path.resolve(dbPathRaw);
  if (isBlockedProductionDbPath(dbPathRaw) || isBlockedProductionDbPath(dbPath)) {
    throw new Error(
      `DB_PATH points to a dev/basic database (${dbPathRaw}). Production must use the persistent SQLite file under /home/bestbond/.local/share/reward-system/data.sqlite — never data.sqlite inside the repo.`,
    );
  }

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `DB_PATH file not found: ${dbPath}. Restore from backup before starting the API.`,
    );
  }

  const sizeBytes = fs.statSync(dbPath).size;
  const minUsers = Number(process.env.PROD_MIN_USER_COUNT ?? 15);
  const userCount = await countSqliteRows(
    dbPath,
    'SELECT COUNT(*) AS count FROM users',
  );
  const couponCount = await countSqliteRows(
    dbPath,
    'SELECT COUNT(*) AS count FROM coupons',
  );

  if (Number.isFinite(minUsers) && minUsers > 0 && userCount < minUsers) {
    throw new Error(
      `Production database at ${dbPath} has only ${userCount} users (minimum ${minUsers}). This usually means the wrong SQLite file is configured. Restore the latest backup from /home/bestbond/.local/share/reward-system/ before reloading PM2.`,
    );
  }

  return { dbPath, sizeBytes, userCount, couponCount };
}
