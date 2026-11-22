# Integrations

## Nodemailer (SMTP) — AUTH-01..04, ORD-04
- Transport from env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. Dev and MVP production: Gmail SMTP (`smtp.gmail.com`, port 587, STARTTLS, app password; `MAIL_FROM` = the Gmail address or a verified alias).
- OTP lifetime is `OTP_TTL_SECONDS` (default 600 = 10 min, AUTH-01; replaces `EMAIL_LINK_TTL_SECONDS`, B-019).
- Templates: `src/emails/templates/{en,ar}/` — `otp-verify`, `otp-reset`, `password-changed`, `order-placed`, `order-status`, `admin-invite`. Arabic templates use `dir="rtl"`.
- Sending is async (not awaited by HTTP response for order emails); OTP emails are awaited so the user gets an error if sending fails.
- Gmail limits daily volume (about 500/day on a free account); switch `SMTP_*` to a transactional provider (Brevo, SES) before launch volume (B-005). On Vercel the send must finish before the function returns (await it or use `waitUntil`).

### Email templates (T-003)
`mailer.send({ to, template, locale, data })` (awaited, rejects on failure) and `mailer.sendInBackground(...)` (never rejects; errors are logged; on Vercel the promise is registered with `waitUntil` from `@vercel/functions`, elsewhere it is fire-and-forget). `locale` is always the recipient's `preferredLocale`; `ar` only when it is missing. Code: `src/emails/`. Money is in halalas and shown as SAR with Western digits.

| Template | Used by | `data` fields |
|---|---|---|
| `otp-verify` | AUTH-01, AUTH-04 | `firstName`, `code` (6 digits), `ttlSeconds` (`OTP_TTL_SECONDS`, shown as minutes) |
| `otp-reset` | AUTH-03 | `firstName`, `code`, `ttlSeconds` |
| `password-changed` | AUTH-03 | `firstName` only (never a code or password); sent in the background after a successful reset, in the user's `preferredLocale`; says to contact support if it was not them |
| `order-placed` | ORD-04 | `firstName`, `orderNo`, `items[] {title: {en, ar}, qty, unitPrice}`, `subtotal`, `deliveryFee`, `vatAmount` (VAT line shown only when > 0), `total` |
| `order-status` | ORD-04 | `firstName`, `orderNo`, `status` (`PENDING`..`CANCELLED`) |
| `admin-invite` | ADM-11 | `firstName`, `code` (OTP, not a link), `ttlSeconds`, `adminUrl` (`ADMIN_URL`) |

## Socket.IO on Vercel — NOTIF-01..03 (ADR-012)
- **Server:** `api/socket-io.ts` (shared factory `src/lib/socketServer.ts`, also mounted by the dev entry), `path: '/api/socket-io/socket.io'`, `transports: ['websocket']`, CORS = `CORS_ALLOWED_ORIGINS` with credentials (the same allow-list also runs in `allowRequest`, because the `cors` option does not guard a websocket upgrade; no Origin header = non-browser client, allowed). **Socket auth = HTTP auth (owner, 2026-11-22, T-023):** the middleware verifies the access token from `socket.handshake.auth.token`, then loads the user from the DB exactly like `requireAuth` — missing, blocked or unverified user, or a token whose `iat` predates `passwordChangedAt`, → `connect_error` `unauthorized`; rooms are joined with the **DB** role, never the token's. After auth the socket joins `user:{id}`, and admins also join `admins`. A timer disconnects the socket when the access token expires (the client reconnects with a fresh token, see below).
- **Abuse limits (T-023):** 30 connection attempts per IP per minute through the T-024 MongoDB store (`limitKey('socket','ip',…)`, counted before auth; over the limit → `connect_error` `rate_limited`); `maxHttpBufferSize` 10 KB; the server registers **no** client→server event handlers — clients only listen, anything a client emits is ignored.
- **Kicking live sockets (T-023):** `socketEmitter.disconnectUser(userId)` force-closes every socket of a user across instances (`in('user:{id}').disconnectSockets(true)`). Called on password reset (T-006), refresh-token reuse detection (T-005) and admin block (T-017).
- **Cross-instance delivery (no Redis):** `@socket.io/mongo-adapter` on the socket server and `@socket.io/mongo-emitter` in the REST API. Collection `socket.io-adapter-events` (env `SOCKET_ADAPTER_COLLECTION`): a **TTL collection** (documents carry `createdAt`; TTL index `expireAfterSeconds: 3600`, env `SOCKET_ADAPTER_TTL_SECONDS`), not capped, so the cron cleanup can delete from it. Needs change streams (Atlas replica set). The notification service first writes (and awaits) the `Notification` row(s), then emits `notification:new` to each recipient's own room — `emitter.to('user:{id}').emit('notification:new', <that user's serialized row, id included>)` — so every client gets a real row id and can mark it read without refetching (owner 2026-11-22, T-016; admin-wide events fan out to one row and one emit per non-blocked admin). Emit failures are logged and ignored (the row is the source of truth). The `admins` room is kept for future broadcast use. One `mongodb` client singleton per instance, `maxPoolSize` 2, same `DATABASE_URL`.
- **Events:** `notification:new` (the recipient's own `Notification`, id included), `order:updated` (`{id, status}`, emitted to `user:{order.userId}` on every status change — a customer self-cancel included: it is state sync, not a notification).
- **Client contract (web `NEXT_PUBLIC_SOCKET_URL`, admin `VITE_SOCKET_URL`):** `io(url, { path: '/api/socket-io/socket.io', transports: ['websocket'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 15000, randomizationFactor: 0.5, auth: cb => cb({ token: freshAccessToken() }) })`. Refresh the access token before reconnecting (when it expires within 60 s, or after an `unauthorized` error; one retry, then log out). After **every** `connect`, re-fetch `GET /notifications` (page 1; the response carries the `unread` count); show a toast for notifications newer than the last one seen (group when more than 3).
- Connections are closed by the platform at the duration limit (about 5 min); this is expected and handled by the reconnect + re-fetch above.

## Cloudflare R2 — ADM-02, ADM-06 (ADR-010, supersedes Cloudinary)
- S3-compatible API via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `region: "auto"`, `endpoint: R2_ENDPOINT`.
- Env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_PUBLIC_BASE_URL` (public custom domain or `r2.dev` URL, no trailing slash). All six are required when `NODE_ENV=production` (start-up fails naming the missing keys); optional in dev/test.
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
- **Upload tracking (T-008).** Every presign inserts an `Upload` row (`data-model.md`). Saves call `syncImages(tx, oldKeys, newKeys, scope)` (never the lower-level helpers directly): added keys are attached (the row must be unattached with the same scope; `avatar` uploads must belong to the user, admin uploads may be attached by any admin), and `HeadObject` must show the object with the approved `ContentType` and size (else 422 `UPLOAD_NOT_ALLOWED`). Removed keys are released (R2 object, then row); unchanged keys and reorders make no S3 calls. Unattached rows older than 24 h are removed by the cron cleanup together with their R2 object. At most 30 presigns per admin per 10 minutes (429 `RATE_LIMITED`).
- **Serving safety.** The R2 public domain (`R2_PUBLIC_BASE_URL`) must send `X-Content-Type-Options: nosniff` on every response (Cloudflare → Rules → Transform Rules → Modify Response Header, set static header). SVG (and any other type outside jpeg/png/webp) is never allowed, so uploaded files cannot carry script. Never log a presigned URL or R2 credentials.
- Tests mock the S3 client (`PutObject` presigner, `DeleteObject`, `HeadObject`); no test touches a real bucket.
- Local `uploads/` disk storage is **not** supported; use a dev bucket (`{env}` in the key keeps environments apart).

## Next.js on-demand revalidation
- Backend → `POST {WEB_REVALIDATE_URL}` (default `{STOREFRONT_URL}/api/revalidate`) with `x-revalidate-secret: REVALIDATE_SECRET`, body `{ tags: ['home','products','product:{slug}','settings','page:{slug}'] }` after admin writes.

## Sentry — NFR-04
- `@sentry/node` initialised only when `SENTRY_DSN` is non-empty; `SENTRY_ENVIRONMENT` tags the environment. Events carry the request id; no secrets, cookies, tokens or request bodies.

## Cron routes — CRON_SECRET
- Vercel Cron calls `GET /internal/cron/cleanup` daily (`0 3 * * *`, `vercel.json`). Vercel sends `Authorization: Bearer <CRON_SECRET>` (it cannot send custom headers); the route also accepts header `x-cron-secret: <CRON_SECRET>` and `POST` for manual runs. Missing/wrong secret → 401; constant-time compare; `CRON_SECRET` unset → route not mounted.
- Cleanup removes: expired or consumed OTPs, expired or revoked refresh tokens, socket adapter documents older than `SOCKET_ADAPTER_TTL_SECONDS`, read notifications (`readAt` set) older than 90 days and unread ones (`readAt` null or missing) older than 180 days (owner, 2026-11-22), and `Upload` rows never attached after 24 h (with their R2 object; 200 per run; an R2 object referenced by an order item's `imageKey` is never deleted). Returns `{otps, refreshTokens, socketEvents, uploads, notifications}` counts. Idempotent.

## Rate limiting store — NFR-01 (ADR-012)
- `express-rate-limit` with a MongoDB store (`RateLimit` collection, one atomic `findAndModify` upsert with an update pipeline, so an expired window resets atomically; TTL index on `resetAt` created idempotently by `ensureIndexes()`, called at start-up and lazily on first use, which is what covers Vercel cold starts). No in-memory or Redis store.
