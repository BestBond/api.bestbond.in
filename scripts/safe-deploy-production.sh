#!/usr/bin/env bash
# Safe production deploy for api.bestbond.in on the VPS.
# Usage (as bestbond): bash scripts/safe-deploy-production.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

read_db_path() {
  grep -E '^DB_PATH=' .env.production | head -1 | cut -d= -f2- | sed 's/^["'\'']//;s/["'\'']$//'
}

DB_PATH="$(read_db_path)"
COUNT_FILE=/tmp/bestbond-pre-deploy-counts.txt
BACKUP_FILE=/tmp/bestbond-pre-deploy-backup.txt

echo "======== PRE-DEPLOY SNAPSHOT ========"
echo "HEAD: $(git rev-parse --short HEAD)"
grep -E '^(DB_PATH|DATABASE_SYNCHRONIZE|NODE_ENV|PORT)=' .env.production
echo "DB_PATH resolved: ${DB_PATH}"
ls -lah "${DB_PATH}"

export DB_PATH
node <<'NODE'
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.env.DB_PATH);
db.get('SELECT COUNT(*) as users FROM users', (e, u) => {
  if (e) throw e;
  db.get('SELECT COUNT(*) as coupons FROM coupons', (e2, c) => {
    if (e2) throw e2;
    const text = `PRE_USERS=${u.users}\nPRE_COUPONS=${c.coupons}\n`;
    fs.writeFileSync('/tmp/bestbond-pre-deploy-counts.txt', text);
    process.stdout.write(text);
    db.close();
  });
});
NODE

echo "======== BACKUP ========"
TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
BACKUP="$(dirname "${DB_PATH}")/data.sqlite.backup-pre-deploy-${TS}"
cp "${DB_PATH}" "${BACKUP}"
ls -lah "${BACKUP}"
echo "${BACKUP}" > "${BACKUP_FILE}"

echo "======== FETCH / RESET ========"
git fetch origin main
git reset --hard origin/main
echo "POST_PULL_HEAD=$(git rev-parse --short HEAD)"
git log -2 --oneline

echo "======== CONFIRM ENV UNCHANGED ========"
grep -E '^(DB_PATH|DATABASE_SYNCHRONIZE|NODE_ENV|PORT)=' .env.production
test "$(read_db_path)" = "/home/bestbond/.local/share/reward-system/data.sqlite"
test -f "${DB_PATH}"

echo "======== BUILD ========"
export PUPPETEER_SKIP_DOWNLOAD=1
npm ci
npm run build
npm prune --omit=dev

echo "======== POST-BUILD COUNTS ========"
node <<'NODE'
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const pre = Object.fromEntries(
  fs.readFileSync('/tmp/bestbond-pre-deploy-counts.txt', 'utf8').trim().split('\n').map((l) => l.split('=')),
);
const db = new sqlite3.Database(process.env.DB_PATH);
db.get('SELECT COUNT(*) as users FROM users', (e, u) => {
  if (e) throw e;
  db.get('SELECT COUNT(*) as coupons FROM coupons', (e2, c) => {
    if (e2) throw e2;
    console.log(`POST_USERS=${u.users}`);
    console.log(`POST_COUPONS=${c.coupons}`);
    if (String(u.users) !== String(pre.PRE_USERS) || String(c.coupons) !== String(pre.PRE_COUPONS)) {
      console.error('ABORT: user/coupon counts changed before reload');
      process.exit(2);
    }
    console.log('COUNTS_OK');
    db.close();
  });
});
NODE

echo "======== PM2 RELOAD ========"
pm2 reload bestbond-reward-api --update-env
sleep 5
pm2 list

echo "======== HEALTH ========"
curl -sS http://127.0.0.1:3001/health
echo

echo "======== STARTUP LOGS ========"
pm2 logs bestbond-reward-api --lines 60 --nostream | tail -60

echo "======== SCHEMA + FINAL COUNTS ========"
node <<'NODE'
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const pre = Object.fromEntries(
  fs.readFileSync('/tmp/bestbond-pre-deploy-counts.txt', 'utf8').trim().split('\n').map((l) => l.split('=')),
);
const db = new sqlite3.Database(process.env.DB_PATH);
db.all('PRAGMA table_info(users)', (e, rows) => {
  if (e) throw e;
  const has = (rows || []).some((r) => r.name === 'wallet_points_expires_at');
  console.log(`wallet_points_expires_at=${has}`);
  db.get('SELECT COUNT(*) as users FROM users', (e2, u) => {
    if (e2) throw e2;
    db.get('SELECT COUNT(*) as coupons FROM coupons', (e3, c) => {
      if (e3) throw e3;
      console.log(`FINAL_USERS=${u.users}`);
      console.log(`FINAL_COUPONS=${c.coupons}`);
      if (String(u.users) !== String(pre.PRE_USERS) || String(c.coupons) !== String(pre.PRE_COUPONS)) {
        console.error('FAIL: counts drifted after reload');
        process.exit(3);
      }
      if (!has) {
        console.error('FAIL: wallet_points_expires_at column missing after reload');
        process.exit(4);
      }
      console.log('FINAL_COUNTS_OK');
      db.close();
    });
  });
});
NODE

echo "======== LOGIN SMOKE ========"
curl -sS -X POST http://127.0.0.1:3001/auth/customer/passcode/login \
  -H 'Content-Type: application/json' \
  -d '{"countryCode":"+91","phone":"9876543210","passcode":"111111"}' | head -c 220
echo
echo "======== DONE ========"
