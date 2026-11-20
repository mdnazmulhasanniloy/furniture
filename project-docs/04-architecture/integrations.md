# Integrations

## Nodemailer (SMTP) — AUTH-01..04, ORD-04
- Transport from env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. Dev: Ethereal or Mailpit.
- `EMAIL_LINK_TTL_SECONDS` exists in the env but its purpose is unconfirmed (B-019); OTP expiry stays 10 min (AUTH-01).
- Templates: `src/emails/templates/{en,ar}/` — `otp-verify`, `otp-reset`, `order-placed`, `order-status`, `admin-invite`. Arabic templates use `dir="rtl"`.
- Sending is async (not awaited by HTTP response for order emails); OTP emails are awaited so the user gets an error if sending fails.
- Production provider: any SMTP (Brevo, Amazon SES, Gmail Workspace) — client to choose (B-005).

## Socket.IO — NOTIF-01..03
- Server attached to the same HTTP server; CORS = `CORS_ALLOWED_ORIGINS` (`STOREFRONT_URL`, `ADMIN_URL`). **Hosting of the realtime server is open (B-017).**
- Auth middleware verifies access token from `socket.handshake.auth.token`; on expiry client reconnects with refreshed token.
- Single instance in MVP → no adapter needed (ADR-005). Scaling later: `@socket.io/redis-adapter` (out of MVP scope).

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
- Cron routes (when mounted) require header `x-cron-secret: CRON_SECRET`. Which jobs exist is open (B-021).
