#!/usr/bin/env bash
#
# api.bestbond.in — Nest reward API (PM2: bestbond-reward-api)
# Run from repo root after cloning to e.g. /var/www/api.bestbond.in
#
#   chmod +x deploy.sh
#   ./deploy.sh
#
# On same VPS as bestbond.in: set PORT=3001 in .env (Next uses 3000).
# Optional: RUN_GIT_PULL=1 ./deploy.sh
#

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "==> [api.bestbond.in] deploy from $ROOT"

if [[ "${RUN_GIT_PULL:-0}" == "1" ]] && [[ -d .git ]]; then
  echo "==> git: fetch + reset"
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    git fetch origin main && git reset --hard origin/main
  elif git rev-parse --verify origin/master >/dev/null 2>&1; then
    git fetch origin master && git reset --hard origin/master
  else
    echo "WARN: no origin/main or origin/master — skip git reset"
  fi
fi

if [[ ! -f ecosystem.config.cjs ]]; then
  echo "ERROR: ecosystem.config.cjs missing in $ROOT"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "ERROR: .env missing. Copy .env.example to .env and set JWT_SECRET, CORS_ORIGINS, PORT, DB_PATH, etc."
  exit 1
fi

export NODE_ENV=production
export PUPPETEER_SKIP_DOWNLOAD=1

echo "==> npm ci --omit=dev"
npm ci --omit=dev

echo "==> npm run build"
npm run build

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not found. Install: npm i -g pm2"
  exit 1
fi

echo "==> pm2 startOrReload bestbond-reward-api"
pm2 startOrReload ecosystem.config.cjs --only bestbond-reward-api --update-env
pm2 save

echo "==> Done. Nginx for api.bestbond.in should proxy to http://127.0.0.1:3001 (confirm PORT in .env)"
