# Integrations

## Nodemailer (SMTP) — AUTH-01..04, ORD-04
- Transport from env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. Dev and MVP production: Gmail SMTP (`smtp.gmail.com`, port 587, STARTTLS, app password; `MAIL_FROM` = the Gmail address or a verified alias).
- OTP lifetime is `OTP_TTL_SECONDS` (default 600 = 10 min, AUTH-01; replaces `EMAIL_LINK_TTL_SECONDS`, B-019).
- Templates: `src/emails/templates/{en,ar}/` — `otp-verify`, `otp-reset`, `order-placed`, `order-status`, `admin-invite`. Arabic templates use `dir="rtl"`.
- Sending is async (not awaited by HTTP response for order emails); OTP emails are awaited so the user gets an error if sending fails.
- Gmail limits daily volume (about 500/day on a free account); switch `SMTP_*` to a transactional provider (Brevo, SES) before launch volume (B-005). On Vercel the send must finish before the function returns (await it or use `waitUntil`).

### Email templates (T-003)
`mailer.send({ to, template, locale, data })` (awaited, rejects on failure) and `mailer.sendInBackground(...)` (never rejects; errors are logged; on Vercel the promise is registered with `waitUntil` from `@vercel/functions`, elsewhere it is fire-and-forget). `locale` is always the recipient's `preferredLocale`; `ar` only when it is missing. Code: `src/emails/`. Money is in halalas and shown as SAR with Western digits.

| Template | Used by | `data` fields |
|---|---|---|
| `otp-verify` | AUTH-01, AUTH-04 | `firstName`, `code` (6 digits), `ttlSeconds` (`OTP_TTL_SECONDS`, shown as minutes) |
| `otp-reset` | AUTH-03 | `firstName`, `code`, `ttlSeconds` |
| `order-placed` | ORD-04 | `firstName`, `orderNo`, `items[] {title: {en, ar}, qty, unitPrice}`, `subtotal`, `deliveryFee`, `vatAmount` (VAT line shown only when > 0), `total` |
| `order-status` | ORD-04 | `firstName`, `orderNo`, `status` (`PENDING`..`CANCELLED`) |
| `admin-invite` | ADM-11 | `firstName`, `code` (OTP, not a link), `ttlSeconds`, `adminUrl` (`ADMIN_URL`) |

## Socket.IO on Vercel — NOTIF-01..03 (ADR-012)
- **Server:** `api/socket-io.ts`, `path: '/api/socket-io/socket.io'`, `transports: ['websocket']`, CORS = `CORS_ALLOWED_ORIGINS` with credentials. Auth middleware verifies the access token from `socket.handshake.auth.token`; bad or expired token → `connect_error` `unauthorized`. After auth the socket joins `user:{id}`, and admins also join `admins`.
- **Cross-instance delivery (no Redis):** `@socket.io/mongo-adapter` on the socket server and `@socket.io/mongo-emitter` in the REST API. Collection `socket.io-adapter-events` (env `SOCKET_ADAPTER_COLLECTION`): a **TTL collection** (documents carry `createdAt`; TTL index `expireAfterSeconds: 3600`, env `SOCKET_ADAPTER_TTL_SECONDS`), not capped, so the cron cleanup can delete from it. Needs change streams (Atlas replica set). The notification service first writes the `Notification` row, then calls `emitter.to('user:{id}' | 'admins').emit('notification:new', payload)`; emit failures are logged and ignored (the row is the source of truth). One `mongodb` client singleton per instance, `maxPoolSize` 2, same `DATABASE_URL`.
- **Events:** `notification:new` (Notification), `order:updated` (`{id, status}`).
- **Client contract (web `NEXT_PUBLIC_SOCKET_URL`, admin `VITE_SOCKET_URL`):** `io(url, { path: '/api/socket-io/socket.io', transports: ['websocket'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 15000, randomizationFactor: 0.5, auth: cb => cb({ token: freshAccessToken() }) })`. Refresh the access token before reconnecting (when it expires within 60 s, or after an `unauthorized` error; one retry, then log out). After **every** `connect`, re-fetch `GET /notifications` (page 1; the response carries the `unread` count); show a toast for notifications newer than the last one seen (group when more than 3).
- Connections are closed by the platform at the duration limit (about 5 min); this is expected and handled by the reconnect + re-fetch above.

## Cloudflare R2 — ADM-02, ADM-06 (ADR-010, supersedes Cloudinary)
- S3-compatible API via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `region: "auto"`, `endpoint: R2_ENDPOINT`.
- Env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_PUBLIC_BASE_URL` (public custom domain or `r2.dev` URL, no trailing slash).
- Flow: admin browser → `POST /admin/uploads/presign` `{fileName, contentType, size}` → `{uploadUrl, key, publicUrl, expiresIn}` → browser `PUT`s the file to `uploadUrl` with the same `Content-Type` → the form saves `{key, width?, height?, alt?}`; the server recomputes `url = R2_PUBLIC_BASE_URL + "/" + key`.
- Rules: jpeg/png/webp only, max 5 MB, URL valid 300 s, key `furnixa/{env}/{yyyy}/{mm}/{uuid}.{ext}`.
- Deleting: remove the object by `key` when an image is removed from a product/banner or a product is deleted; failures are logged and never fail the request.
- **Bucket CORS rule** (R2 → bucket → Settings → CORS policy). Replace the origin with `ADMIN_URL` of each environment (list several for dev + production):

```json
[
  {
    "AllowedOrigins": ["http://localhost:3101", "https://admin.furnixa.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```
  Public image reads (`<img>`, Next.js image optimizer) need no CORS rule. `Content-Length` is set by the browser and must match the signed `size`.
- Tests mock the S3 client; no test touches a real bucket.
- Local `uploads/` disk storage is **not** supported; use a dev bucket (`{env}` in the key keeps environments apart).

## Next.js on-demand revalidation
- Backend → `POST {WEB_REVALIDATE_URL}` (default `{STOREFRONT_URL}/api/revalidate`) with `x-revalidate-secret: REVALIDATE_SECRET`, body `{ tags: ['home','products','product:{slug}','settings','page:{slug}'] }` after admin writes.

## Sentry — NFR-04
- `@sentry/node` initialised only when `SENTRY_DSN` is non-empty; `SENTRY_ENVIRONMENT` tags the environment. Events carry the request id; no secrets, cookies, tokens or request bodies.

## Cron routes — CRON_SECRET
- Vercel Cron calls `GET /internal/cron/cleanup` daily (`0 3 * * *`, `vercel.json`). Vercel sends `Authorization: Bearer <CRON_SECRET>` (it cannot send custom headers); the route also accepts header `x-cron-secret: <CRON_SECRET>` and `POST` for manual runs. Missing/wrong secret → 401; constant-time compare; `CRON_SECRET` unset → route not mounted.
- Cleanup removes: expired or consumed OTPs, expired or revoked refresh tokens, socket adapter documents older than `SOCKET_ADAPTER_TTL_SECONDS`. Returns `{otps, refreshTokens, socketEvents}` counts. Idempotent.

## Rate limiting store — NFR-01 (ADR-012)
- `express-rate-limit` with a MongoDB store (`RateLimit` collection, atomic `findAndModify` upsert with `$inc`, TTL index on `resetAt` created by `ensureIndexes()` at start-up). No in-memory or Redis store.
