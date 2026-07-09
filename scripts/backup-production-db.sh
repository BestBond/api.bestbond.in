#!/usr/bin/env bash
# Back up the production SQLite database before deploys or manual edits.
# Run on the VPS as bestbond: bash scripts/backup-production-db.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env.production"

if [[ -f "${ENV_FILE}" ]]; then
  DB_PATH="$(grep -E '^DB_PATH=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '"'"'"'")"
else
  DB_PATH="${DB_PATH:-/home/bestbond/.local/share/reward-system/data.sqlite}"
fi

if [[ -z "${DB_PATH}" ]]; then
  echo "DB_PATH is empty — set it in .env.production" >&2
  exit 1
fi

if [[ ! -f "${DB_PATH}" ]]; then
  echo "Database file not found: ${DB_PATH}" >&2
  exit 1
fi

DEST_DIR="$(dirname "${DB_PATH}")"
TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
BACKUP="${DEST_DIR}/data.sqlite.backup-${TS}"

cp "${DB_PATH}" "${BACKUP}"
ls -lah "${BACKUP}"
echo "Backup OK: ${BACKUP}"
