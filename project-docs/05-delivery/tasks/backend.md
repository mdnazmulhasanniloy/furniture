# Backend Tasks

Status: `todo` · `in-progress` · `review` · `done` · `blocked`. Docs paths are relative to `project-docs/`.
Done = every listed acceptance criterion of the linked requirement has a passing test (vitest + supertest) and `api-spec.yaml` matches the implementation.

### T-001 Bootstrap backend · done
- Req: NFR-01, NFR-04 · Depends: — 
- Docs: `04-architecture/system-architecture.md`, `04-architecture/infra-deployment.md`
- Done: Express 5 + TS strict, app exported for Vercel (`api/index.ts`, ADR-012); zod-validated env covering every key in `backend/.env.example` (ADR-011: production requires `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_PEPPER`, `CSRF_SECRET` ≥ 32 chars and `CORS_ALLOWED_ORIGINS`; empty secrets outside production are generated at start-up; `AUTH_COOKIE_SECURE` empty = true in production); dependencies switched per ADR-010/011 (remove `bcryptjs`, `cloudinary`, `multer`; add `argon2`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@sentry/node`, `mongodb`, `@socket.io/mongo-adapter`, `@socket.io/mongo-emitter`, `@vercel/functions`); `PrismaClient` as a `globalThis` singleton; `TRUST_PROXY` parsed (`1` in production); `OTP_TTL_SECONDS`, `SOCKET_ADAPTER_COLLECTION`, `SOCKET_ADAPTER_TTL_SECONDS` and `CRON_SECRET` validated; `prisma generate` in `postinstall`; port 4100; Sentry initialised only when `SENTRY_DSN` is set; pino logger with request id; helmet, CORS allow-list, cookie-parser; central error handler returning `Error` schema; `GET /health` → 200; vitest + supertest set up with `mongodb-memory-server` replica set; ESLint + Prettier; `npm run typecheck` clean.

### T-002 Prisma schema + seed · done
- Req: NFR-05 (all data) · Depends: T-001
- Docs: `04-architecture/data-model.md`, `adr/ADR-001`, `adr/ADR-006`
- Done: `prisma/schema.prisma` matches data-model (aligned 2026-11-20: `User.firstName`/`lastName`, `RateLimit`, SAR, `defaultLocale` ar, `deliveryCities`, `cityCode`, `VatSetting`, `OrderVat`; validated with Prisma 6); `prisma db push` works on replica set; `npm run seed` creates 1 admin (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME`), 6 categories, SiteSetting singleton (`deliveryFee` 0, `freeDeliveryThreshold` null, `vat` = {vatRate 0, applyToDelivery true, pricesIncludeVat true}, 6 active cities: riyadh, jeddah, mecca, medina, dammam, khobar), default HomeSections, sample pages (about, faq, terms, privacy, contact) in en+ar, 12 sample products (6 NEW, 6 RESALE).
- Amended (approved plan): seed is create-if-missing and never overwrites admin-managed data (admin, SiteSetting, home sections only when empty, pages/categories by slug). Base seed always; demo seed (12 products, `images: []`) only with `SEED_DEMO_DATA=true` and refused when `NODE_ENV=production`. `terms`/`privacy` seeded unpublished with PLACEHOLDER text (en+ar). Missing-image placeholder tracked in B-022.

### T-003 Mailer + templates · done
- Req: AUTH-01, AUTH-03, ORD-04 · Depends: T-001
- Docs: `04-architecture/integrations.md`
- Done: `mailer.send({to, template, locale, data})`; templates in en/ar with RTL; unit test renders each template in both locales; Gmail SMTP by default, Mailpit optional (SMTP_HOST=localhost, SMTP_PORT=1025).

### T-004 Register, verify OTP, resend OTP · done
- Req: AUTH-01, AUTH-04 · Depends: T-002, T-003
- Docs: `02-product/PRD.md#5.1`, `adr/ADR-003`, `api-spec.yaml` (/auth/register, /auth/verify-otp, /auth/resend-otp)
- Done: all AUTH-01/04 Given/When/Then covered by tests incl. 5 wrong attempts, expiry after `OTP_TTL_SECONDS` (fake timers; default 600), 60 s cooldown, 5/hour cap; register requires `firstName` and `lastName` (422 otherwise).

### T-005 Login, refresh, logout, me, auth/role middleware · todo
- Req: AUTH-02, AUTH-05, AUTH-06 · Depends: T-004, T-024
- Note: depends on T-024 (MongoDB rate-limit store) because the AUTH-02 IP rate-limit test (10 failures / 15 min / IP -> 429) needs it. Do T-024 first. No stub admin route in production code for AUTH-06 (approach to be decided later).
- Docs: `PRD#5.1`, `roles-permissions.md`, `adr/ADR-003`
- Done: tests for unverified login, blocked login, rate limit, refresh rotation + reuse detection, customer → admin route = 403. Tests named `AUTH-02`/`AUTH-05` (ADR-011): argon2id hash verifies; `LOGIN_MAX_FAILURES` failures → 429 `ACCOUNT_LOCKED` until `LOGIN_LOCKOUT_SECONDS` pass (use fake timers), success resets the counter; login number `MAX_ACTIVE_SESSIONS`+1 revokes the oldest session; refresh TTL is `REFRESH_TOKEN_TTL_SECONDS`; `/auth/refresh` and `/auth/logout` without/with bad `X-CSRF-Token` → 403 `CSRF_INVALID`, with a valid one → success; cookie flags follow env.
- Unverified login (added by T-027): uses the same rule as `POST /auth/resend-otp` for VERIFY_EMAIL. The submitted password is matched (argon2 verify) against the unexpired `pendingRegistration.passwordHash` rows of the email, and the new OTP is bound to the matching row only. No match -> identical response and decoy row, cooldown and hourly cap unchanged. Test named `AUTH-01`/`AUTH-02`: an attacker who registered later does not get a code bound to their data when the victim logs in.

### T-006 Forgot / reset password · todo
- Req: AUTH-03 · Depends: T-005
- Done: identical response for unknown email; reset revokes all refresh tokens (tested).

### T-007 Profile + addresses · todo
- Req: PROF-01, PROF-02 · Depends: T-005
- Done: CRUD tests; only one default address; cannot access another user's address (404). Tests named `PROF-02`: unknown/inactive `cityCode` -> 422 `OUT_OF_DELIVERY_AREA`; phone normalization via the shared Saudi phone validator (T-020).

### T-008 Image uploads (R2 presign + delete) · todo
- Req: ADM-02, ADM-06 · Depends: T-005
- Docs: `integrations.md#cloudflare-r2`, `adr/ADR-010`
- Done: `POST /admin/uploads/presign` (admin only; customer → 403) returns `{uploadUrl, key, publicUrl, expiresIn: 300}`. Tests named `ADM-02` with the S3 client **mocked** (`vi.mock('@aws-sdk/client-s3')` and the presigner; no network): accepts jpeg/png/webp, rejects other types and size > 5 242 880 → 422 `UPLOAD_NOT_ALLOWED`; key matches `^furnixa/{env}/\d{4}/\d{2}/[0-9a-f-]{36}\.(jpg|png|webp)$` and ignores `fileName`; presigner called with bucket, key, `ContentType`, `ContentLength` and `expiresIn` 300; `publicUrl` = `R2_PUBLIC_BASE_URL/key`; product/banner save recomputes `url` from `key` and rejects keys outside `furnixa/{env}/`; removing an image from a product or banner, and deleting a product, call `DeleteObject` for each key; when `DeleteObject` rejects the request still succeeds and the error is logged. Bucket CORS rule documented (done in `integrations.md`).

### T-009 Categories (public + admin) · todo
- Req: CAT-01, ADM-03 · Depends: T-005
- Done: tree endpoint returns active only; admin CRUD; delete with products → 409.

### T-010 Products (public + admin) · todo
- Req: PROD-01, PROD-02, ADM-02, I18N-02 · Depends: T-009
- Done: all filters/sort/pagination tested; only PUBLISHED public; PUBLISH requires both `en` and `ar` title/description; delete → archive if in orders; related products.

### T-011 CMS: banners, home sections, pages, settings + revalidation hook · todo
- Req: ADM-06, ADM-07, ADM-08, ADM-09 · Depends: T-010
- Done: `/cms/home` filters banners by schedule/active and resolves section products; reorder endpoint; revalidate webhook called (mocked in test) after each admin write. Settings (ADM-09): `/cms/settings` returns active cities only; `PUT /admin/settings` validates (negative fee/threshold -> 422, `vatRate` outside 0-50 or > 2 decimals -> 422, registration number pattern). Delivery/VAT/cities rules are covered by T-021 and T-022.

### T-012 Cart · todo
- Req: CART-01 · Depends: T-010
- Done: qty capped at stock (409 when above); merge endpoint sums qty capped at stock; cart response flags `issue` for changed items; `GET /cart?addressId=` returns `deliveryFee` and `vat` from the shared pricing function (T-021); tests named `CART-01`: defaults 0 -> fee 0 and VAT amount 0; city override; fallback to base fee.

### T-013 Place order + my orders · todo
- Req: ORD-01, ORD-02 · Depends: T-012, T-007
- Docs: `system-architecture.md#stock-consistency`
- Done: transactional stock decrement; concurrent test (2 buyers, stock 1 → exactly one succeeds); orderNo format `FX-YYYYMMDD-NNNN`; cart cleared; `order.created` event emitted. Tests named `ORD-01`: address in unknown/inactive city -> 422 `OUT_OF_DELIVERY_AREA`, nothing decremented; order stores `deliveryFee` and `vat` snapshot (`vatRate`, `vatAmount`, `applyToDelivery`, `pricesIncludeVat`) even when 0; changing settings afterwards leaves the order unchanged; `expectedTotal` mismatch -> 409 `PRICE_CHANGED`, nothing decremented, order not created.

### T-014 Admin orders + status flow + order emails · todo
- Req: ADM-04, ORD-04 · Depends: T-013, T-003
- Done: transition matrix tested (invalid → 409 INVALID_TRANSITION); DELIVERED sets PAID; CANCELLED restores stock; email sent in customer locale; `order.statusChanged` emitted.

### T-015 Customer cancel · todo
- Req: ORD-03 · Depends: T-014
- Done: tests named `ORD-03`: customer cancels own PENDING order -> CANCELLED, stock restored; CONFIRMED or later -> 409 `INVALID_TRANSITION`; another user's order -> 404.

### T-016 Notifications service + socket server · todo
- Req: NOTIF-01, NOTIF-02, NOTIF-03, ADM-10 · Depends: T-014, T-023
- Done: socket auth rejects bad token (`unauthorized`); new order → each admin gets a Notification row + `notification:new` to room `admins`; status change → customer gets one in room `user:{id}`; list/read/read-all/unread count tested with socket.io-client; the row is written before the emit and a failing emit is logged without failing the request. Tests named `NOTIF-01`, `NOTIF-02`, `NOTIF-03` including **"notification created while the socket was disconnected is shown after reconnect"** (client disconnects, order status changes, client reconnects, `GET /notifications` returns it with `unread` incremented).

### T-017 Admin customers + admin users · todo
- Req: ADM-05, ADM-11 · Depends: T-005
- Done: block revokes tokens and blocks login; invite creates unverified ADMIN and sends OTP.

### T-018 Dashboard summary · todo
- Req: ADM-01 · Depends: T-014
- Done: aggregates tested with fixed seed data (today, pending, month revenue from DELIVERED, low stock ≤ 2, 30-day series).

### T-019 Hardening + spec conformance · todo
- Req: NFR-01, NFR-02 · Depends: T-001..T-018
- Done: response validation test against `api-spec.yaml` for every route (e.g. `jest-openapi`/`openapi-response-validator`); rate limits on auth; p95 check script with 1k products.

### T-020 Saudi phone validator + city validation helper · todo
- Req: NFR-06, PROF-01, PROF-02 · Depends: T-001 · Docs: `adr/ADR-008`, `api-spec.yaml#SaudiPhoneInput`
- Done: shared zod `saudiPhone` accepts `05XXXXXXXX`, `5XXXXXXXX`, `+9665XXXXXXXX`, `009665XXXXXXXX` and normalizes to `+9665XXXXXXXX`; rejects landlines, wrong length, non-digits; used by profile and address; tests named `NFR-06`. Helper `assertActiveCity(cityCode)` throws 422 `OUT_OF_DELIVERY_AREA`.

### T-021 Pricing: delivery fee, VAT, totals (pure function + settings) · todo
- Req: ADM-14, NFR-07, CART-01, ORD-01 · Depends: T-002 · Docs: `adr/ADR-009`, `data-model.md` (money note)
- Done: one pure `computePricing({subtotal, city, settings})` used by cart and orders, integer halalas only. Tests named `ADM-14` / `NFR-07`: (1) all defaults -> fee 0, `vatAmount` 0, total = subtotal, no VAT; (2) base fee applies when the city has no override; (3) city override beats base fee; (4) no override and no base fee -> 0; (5) threshold met -> 0, threshold empty -> never free; (6) `vatRate` 0 -> no VAT even with the toggle on; (7) `applyToDelivery` true/false changes the VAT base only when `vatRate` > 0; (8) inclusive and exclusive formulas with half-up rounding (e.g. 15% on base 12500 -> inclusive 1630, exclusive 1875); (9) exclusive total = subtotal + fee + VAT; (10) snapshot unaffected by later settings changes.
- Settings endpoints: `GET/PUT /admin/settings` persist `deliveryFee`, `freeDeliveryThreshold`, `vat`, per-city `deliveryFee`; defaults when absent are 0 / null / {0, true, true}.

### T-022 Delivery cities admin API rules · todo
- Req: ADM-13 · Depends: T-011 · Docs: `adr/ADR-008`
- Done: add city (both names required, unique immutable `code`), rename, reorder, toggle active; removing or changing a code -> 409; cannot deactivate the last active city -> 422; deactivated city hidden from `/cms/settings` and rejected by address create/checkout; existing orders unchanged; per-city `deliveryFee` override validated (>= 0 or null). Tests named `ADM-13`.

### T-023 Socket.IO on MongoDB adapter + emitter (serverless) · todo
- Req: NOTIF-01, NOTIF-02, NOTIF-03 · Depends: T-001, T-002 · Docs: `adr/ADR-012`, `integrations.md#socketio-on-vercel`
- Done: `src/lib/mongo.ts` driver singleton (`maxPoolSize` 2, `DATABASE_URL`); `api/socket-io.ts` serves path `/api/socket-io/socket.io`, websocket transport, CORS from `CORS_ALLOWED_ORIGINS`; `@socket.io/mongo-adapter` on collection `SOCKET_ADAPTER_COLLECTION` with `createdAt` and TTL index `SOCKET_ADAPTER_TTL_SECONDS`; `src/lib/emitter.ts` wraps `@socket.io/mongo-emitter` (`toUser(id)`, `toAdmins()`). **Spike first:** tests start **two separate Socket.IO server instances** and an emitter on a third client against `mongodb-memory-server` (replica set); a client on instance B receives an event emitted from the emitter (`NOTIF-01 · cross-instance delivery`). If the Atlas tier cannot run change streams, record it in blockers and fall back to a capped collection. Dev entry `server.ts` mounts the same server on port 4100.

### T-024 MongoDB rate-limit store · in-progress
- Req: NFR-01, AUTH-02 · Depends: T-002 · Docs: `adr/ADR-012`, `data-model.md` (RateLimit)
- Done: `rateLimit.ts` uses `express-rate-limit` with a custom store (`increment`, `decrement`, `resetKey`, `resetAll`) over `RateLimit` with one atomic `findAndModify` upsert (`$inc`); `ensureIndexes()` creates the TTL index idempotently and is called at start-up; keys `rl:{limiter}:{ip}`; fails open with a logged error when MongoDB errors. Tests named `NFR-01`: two app instances share one counter (the 11th login attempt from one IP in 15 min gets 429 across instances); window expiry resets; the TTL index exists with `expireAfterSeconds: 0`; fail-open path; `TRUST_PROXY=1` uses the forwarded IP.

### T-025 Cron cleanup route · todo
- Req: NFR-08, NFR-01 · Depends: T-005, T-023 · Docs: `adr/ADR-012`, `integrations.md#cron-routes--cron_secret`
- Done: `GET|POST /internal/cron/cleanup` (not under `/api/v1`), `cronAuth` accepts `Authorization: Bearer CRON_SECRET` or `x-cron-secret`, constant-time compare, 401 otherwise, not mounted when `CRON_SECRET` is unset, a normal user JWT is rejected. Deletes: OTPs with `expiresAt` < now or `consumedAt` set; refresh tokens with `expiresAt` < now or `revokedAt` set; adapter documents with `createdAt` older than `SOCKET_ADAPTER_TTL_SECONDS`. Returns `{otps, refreshTokens, socketEvents}`; running twice is safe. Tests named `NFR-08` with seeded rows (kept rows stay, removed rows go) and secret handling.

### T-026 Vercel configuration · todo
- Req: NFR-08 · Depends: T-001, T-023 · Docs: `adr/ADR-012`, `infra-deployment.md`
- Done: `api/index.ts` (`export default app`) and `api/socket-io.ts`; `backend/vercel.json` (functions, rewrites, crons; already drafted); `prisma generate` runs on build with the right `binaryTargets`; Atlas URL options documented in `.env.example`; preview deploy answers `GET /health`, a login, and a websocket connect; the daily cron fires on the preview/production project (`CRON_SECRET` set in Vercel). Verify duration limits and WebSocket support against the current Vercel plan and note the result in `infra-deployment.md`.

### T-027 Close the VERIFY_EMAIL resend race · done
- Req: AUTH-01, AUTH-04 · Depends: T-004 · Docs: `api-spec.yaml` (/auth/resend-otp), `adr/ADR-003`
- Done: `POST /auth/resend-otp` with purpose `VERIFY_EMAIL` requires `{email, password}` (422 without); the server finds the unexpired VERIFY_EMAIL `Otp` row (also one burnt by the wrong-code lockout) whose `pendingRegistration.passwordHash` verifies against the password (argon2) and binds the new OTP to that row's pending data only. No match (unknown email, wrong password, already verified) -> identical 200 and a decoy row; cooldown and hourly cap behave the same either way; RESET_PASSWORD stays `{email, purpose}`. Spec updated first. Tests: `AUTH-01 · resend with the victim's password binds to the victim's registration even after an attacker registered later`; `AUTH-04 · resend with a wrong password returns the identical 200 response and sends no email`; `AUTH-04 · cooldown and hourly cap still apply to password-matched resend`. Also T-004 review notes: `fx_rt` cookie flags in the spec; English-only error message rule in web/admin CLAUDE.md; en/ar tests that the otp-reset email has the "ignore if you did not request" line. Residual (documented): after the 10-minute OTP TTL a resend finds no live row and the user must register again.
