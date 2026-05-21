#!/usr/bin/env bash
# One-time (or after OS updates): ensure Chromium exists for coupon PDF export.
# Run on the VPS as root or with sudo: bash scripts/ensure-chromium-for-pdf.sh
set -euo pipefail

find_chromium() {
  for p in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome-stable /snap/bin/chromium; do
    if [ -x "$p" ]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

if CHROME="$(find_chromium)"; then
  echo "Chromium OK: $CHROME"
  echo "Add to .env.production:"
  echo "PUPPETEER_EXECUTABLE_PATH=$CHROME"
  exit 0
fi

echo "Chromium not found — installing via apt (Debian/Ubuntu)…"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  if apt-get install -y chromium 2>/dev/null; then
    :
  else
    apt-get install -y chromium-browser || apt-get install -y chromium
  fi
  apt-get install -y --no-install-recommends fonts-liberation 2>/dev/null || true
fi

if CHROME="$(find_chromium)"; then
  echo "Installed: $CHROME"
  echo "Add to .env.production:"
  echo "PUPPETEER_EXECUTABLE_PATH=$CHROME"
  exit 0
fi

echo "Could not install Chromium automatically."
echo "Either:"
echo "  1) apt install chromium && set PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium"
echo "  2) From api.bestbond.in: PUPPETEER_SKIP_DOWNLOAD=0 npx puppeteer browsers install chrome"
exit 1
