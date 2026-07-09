import { Logger } from '@nestjs/common';
import * as path from 'path';

const logger = new Logger('SchemaEnsure');

/**
 * Additive-only: add nullable wallet_points_expires_at when missing.
 * Safe with DATABASE_SYNCHRONIZE=false; does not drop or rewrite tables.
 */
export async function ensureWalletExpiryColumn(): Promise<void> {
  const dbPathRaw = process.env.DB_PATH?.trim() || 'data.sqlite';
  const dbPath = path.resolve(dbPathRaw);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqlite3 = require('sqlite3') as typeof import('sqlite3');

  await new Promise<void>((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (openErr) => {
      if (openErr) {
        reject(openErr);
        return;
      }
      db.all('PRAGMA table_info(users)', (infoErr, rows: { name: string }[]) => {
        if (infoErr) {
          db.close();
          reject(infoErr);
          return;
        }
        const hasCol = (rows ?? []).some(
          (r) => r.name === 'wallet_points_expires_at',
        );
        if (hasCol) {
          db.close();
          resolve();
          return;
        }
        logger.warn(
          'Adding nullable column users.wallet_points_expires_at (wallet expiry feature)',
        );
        db.run(
          'ALTER TABLE users ADD COLUMN wallet_points_expires_at datetime',
          (alterErr) => {
            db.close();
            if (alterErr) reject(alterErr);
            else resolve();
          },
        );
      });
    });
  });
}
