# MSG91 OTP (BestBond / reward-system-backend)

This document covers **MSG91** setup for the production OTP APIs:

- `POST /otp/send` — sends an OTP via MSG91 (India DLT).
- `POST /otp/verify` — verifies with MSG91, then creates a **customer** user if needed and returns a **JWT** (same shape as `POST /auth/customer/otp/login`).

Existing routes (`/auth/otp/request`, `/auth/customer/otp/login`, etc.) are **unchanged**. You can migrate the mobile app to `/otp/*` when ready.

---

## Environment variables (copy into `.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `MSG91_AUTHKEY` | **Yes** (for `/otp/*`) | Auth key from MSG91 dashboard (API section). |
| `MSG91_TEMPLATE_ID` | **Yes** | OTP template ID from MSG91 (see below). |
| `MSG91_BASE_URL` | No | Default `https://control.msg91.com`. |
| `MSG91_OTP_LENGTH` | No | Default `6` (allowed 4–9 per MSG91). |
| `MSG91_OTP_EXPIRY_MIN` | No | Default `10` (1–1440). |
| `MSG91_DLT_TE_ID` | Often **yes** in India | DLT Template Entity ID mapped to your SMS template (operator requirement). |
| `MSG91_SEND_COOLDOWN_SEC` | No | Per-server-instance cooldown between sends for the same mobile (default `45`). |
| `MSG91_OTP_ENABLED` | No | Set to `0` to disable `/otp/*` without removing the module. |

Example:

```env
MSG91_AUTHKEY=your_auth_key_here
MSG91_TEMPLATE_ID=your_template_id_here
MSG91_DLT_TE_ID=your_dlt_te_id_if_required
MSG91_OTP_LENGTH=6
MSG91_OTP_EXPIRY_MIN=10
MSG91_SEND_COOLDOWN_SEC=45
```

---

## MSG91 dashboard — step by step

### 1. Create / approve OTP SMS template (India DLT)

1. Log in to [MSG91](https://control.msg91.com/).
2. Go to **DLT** / **SMS** / **Templates** (wording varies) and create an **OTP** or **Transactional** template with your message, e.g. `Your OTP is {#var#}. Valid for {#var#} minutes.`  
3. Get the template approved on **DLT** (India).  
4. In MSG91, **map** the approved DLT template to your MSG91 OTP template and note **`MSG91_DLT_TE_ID`** if the API requires it.

### 2. OTP template ID (`MSG91_TEMPLATE_ID`)

1. Open **OTP** (or **Send OTP** / **API**) in the sidebar.  
2. Create or select an **OTP template** linked to your approved SMS content.  
3. Copy the **Template ID** shown in the panel → `MSG91_TEMPLATE_ID`.

### 3. Auth key (`MSG91_AUTHKEY`)

1. Go to **API** or **Account → API** (or **Developer**).  
2. Copy **Auth Key** (sometimes called API key) → `MSG91_AUTHKEY`.  
3. **Never** commit it to git; only set it in `.env` on the server.

### 4. Enable OTP service & sender

1. Ensure **OTP** product is enabled on your account (billing / plan).  
2. Configure **Sender ID** / route as required by MSG91 for your country (India: DLT-approved sender).  
3. Complete any **KYC** or **domain/IP whitelist** steps shown in the dashboard (varies by account).

### 5. Whitelist IPs / domains (if shown)

- If MSG91 offers **IP whitelist** for API calls, add your **VPS egress IP** (curl `https://ifconfig.me` from the server).  
- **OTP Widget** (browser) uses different keys/domains; this backend uses **server-to-server** REST only.

### 6. Test OTPs

1. Use **MSG91 test tools** or hit your API:

```bash
curl -sS -X POST "http://127.0.0.1:3000/otp/send" \
  -H "Content-Type: application/json" \
  -d '{"mobile":"9198XXXXXXXX"}'

curl -sS -X POST "http://127.0.0.1:3000/otp/verify" \
  -H "Content-Type: application/json" \
  -d '{"mobile":"9198XXXXXXXX","otp":"123456"}'
```

2. Use a **real handset** on DLT; sandbox behaviour depends on MSG91 account settings.

---

## API contract

### `POST /otp/send`

**Body**

```json
{ "mobile": "919876543210" }
```

- `mobile` must be **12 digits**: `91` + 10-digit Indian mobile (first digit of subscriber number 6–9).

**Success (200)**

```json
{ "success": true, "data": { "sent": true } }
```

### `POST /otp/verify`

**Body**

```json
{ "mobile": "919876543210", "otp": "123456" }
```

**Success (200)**

```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt>",
    "roles": ["CUSTOMER"],
    "permissions": ["..."],
    "isNewUser": true
  }
}
```

- **Staff numbers** (Super Admin / Ops Admin) are **rejected** with `403` — they must use `/auth/admin/otp/login`.

Errors use Nest’s default JSON (`statusCode`, `message`, …).

---

## Rate limiting

- Global throttler is enabled in `app.module.ts`.  
- `/otp/send`: **5 requests / minute / IP** (controller throttle).  
- `/otp/verify`: **20 requests / minute / IP**.  
- Additional **per-mobile** cooldown: `MSG91_SEND_COOLDOWN_SEC` (in-memory; see Redis below).

---

## Production recommendations

1. **Secrets**: inject `MSG91_*` via your process manager (PM2) or vault; rotate keys on compromise.  
2. **HTTPS only** for the API behind nginx; HSTS for admin domains.  
3. **JWT**: strong `JWT_SECRET`, short `JWT_EXPIRES_IN`, consider refresh tokens later.  
4. **Observability**: ship logs to your stack; **do not** log OTPs or raw `authkey`.  
5. **Multi-instance API**: replace in-memory `lastSendAt` cooldown with **Redis** `SET otp:cooldown:{mobile} NX EX {sec}` before calling MSG91.  
6. **Redis** (optional): also store `otp:attempts:{mobile}` with TTL for lockout after N failed verifies (MSG91 verifies server-side, but you can add app-level abuse control).

---

## Nginx

- Proxy `/` to Nest on `127.0.0.1:3001` (or your `PORT`).  
- Set `client_max_body_size` small (e.g. `1m`) for JSON APIs.  
- Forward `X-Forwarded-For` and set `TRUST_PROXY=1` on Nest when behind nginx so throttling uses real client IPs.

---

## Folder structure (added)

```
src/
  auth/
    jwt-module.factory.ts    # shared JwtModule.registerAsync
  common/
    http/
      standard-response.ts    # { success, data } helper
  otp/
    dto/
      send-otp.dto.ts
      verify-otp.dto.ts
    interfaces/
      msg91-api.types.ts
    msg91.service.ts          # HTTP client to MSG91
    otp.service.ts            # business: cooldown, user, JWT
    otp.controller.ts
    otp.module.ts
```

---

## React Native

See `BestBond/src/api/msg91Otp.ts` for typed `sendMsg91Otp` / `verifyMsg91Otp` using the existing `apiPost` client. Persist `accessToken` with your existing `setAccessToken` from `api/storage.ts`.
