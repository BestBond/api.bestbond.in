# Deploying `api.bestbond.in` (manual)

Production clone: **`/var/www/api.bestbond.in`**  
PM2 app name: **`bestbond-reward-api`**  
Default port: **`3001`** (when `bestbond.in` uses **3000**)

## One-time setup

1. **DNS** — A record `api.bestbond.in` → server IP.

2. **Clone**

   ```bash
   mkdir -p /var/www
   cd /var/www
   git clone git@github.com:BestBond/reward_system_backend.git api.bestbond.in
   cd api.bestbond.in
   ```

3. **Environment**

   ```bash
   cp .env.production.example .env.production
   nano .env.production
   ```

   Required: `PORT=3001`, `TRUST_PROXY=1`, `CORS_ORIGINS=https://admin.bestbond.in,https://bestbond.in`, strong `JWT_SECRET`, `DB_PATH`, `DATABASE_SYNCHRONIZE=false`.

   Local dev: `cp .env.example .env.local` then `npm run start:dev`.

4. **Nginx** — Copy `deploy/nginx-api.bestbond.in.conf.sample` to `/etc/nginx/sites-available/api.bestbond.in`, enable, `nginx -t`, reload. TLS: `certbot --nginx -d api.bestbond.in` (or `certbot install` if cert exists).

5. **First run** — follow [Deploy / update](#deploy--update) below.

## Coupon PDF export (Chromium)

Batch PDF (`GET /coupons/batches/:id/export.pdf`) uses **Puppeteer**. Each coupon is **101×38 mm** with **5 mm** safe inset; coupons are stacked on A4 with **no gap** between rows. On Linux production the API uses **`@sparticuz/chromium`** automatically (no `apt` / sudo required). Keep `PUPPETEER_SKIP_DOWNLOAD=1` for `npm ci`.

Local development does not use the VPS Chromium path. It first uses Puppeteer's local browser download, then common installed Chrome/Chromium paths for the current OS. Keep local browser settings in `.env.local`; keep VPS settings in `.env.production`.

Optional overrides in `.env.production`:

```env
# PUPPETEER_USE_SPARTICUZ=0
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

If you disable Sparticuz, install system Chromium: `sudo bash scripts/ensure-chromium-for-pdf.sh`

## Deploy / update

Run from `/var/www/api.bestbond.in`:

```bash
git pull   # optional

export PUPPETEER_SKIP_DOWNLOAD=1
# Do not set NODE_ENV=production before install — npm skips devDependencies and `nest build` fails.
npm ci
npm run build
npm prune --omit=dev

pm2 startOrReload ecosystem.config.cjs --only bestbond-reward-api --update-env
pm2 save
```

Verify:

```bash
curl -sS http://127.0.0.1:3001/health
pm2 status
```

## PM2 reload only (no rebuild)

```bash
pm2 reload bestbond-reward-api --update-env
```

## Nginx upstream

Upstream must match `PORT` in `.env.production` (typically **3001**). See `deploy/nginx-api.bestbond.in.conf.sample`.

## Mobile account deletion (App Store 5.1.1)

Customer/dealer apps call:

```http
DELETE /users/me
Authorization: Bearer <token>
Content-Type: application/json

{ "passcode": "123456" }
```

- Verifies the 6-digit passcode, then deactivates the account and clears personal fields (phone, name, address, PIN).
- Staff roles (`SUPERADMIN`, `OPERATIONAL_ADMIN`) receive `403` — not deletable from the mobile app.

## Troubleshooting

### `nest: not found`

`NODE_ENV=production` was set before `npm ci`. Unset it, run `npm ci`, then `npm run build`.

### Port clash with marketing site

If `bestbond.in` uses **3000**, this API must use **3001** in `.env.production` and nginx upstream.

### CORS / HTTPS

With nginx TLS, set `TRUST_PROXY=1` and include `https://admin.bestbond.in` in `CORS_ORIGINS`.

### Coupon PDF returns 500 / “Internal server error”

1. Confirm production is running with `NODE_ENV=production`.
2. Confirm `@sparticuz/chromium` is installed: `npm ls @sparticuz/chromium`.
3. If Sparticuz is disabled, run `sudo bash scripts/ensure-chromium-for-pdf.sh`, set `PUPPETEER_EXECUTABLE_PATH` in `.env.production`, and `pm2 reload bestbond-reward-api --update-env`.
4. Check logs: `pm2 logs bestbond-reward-api --lines 50`
