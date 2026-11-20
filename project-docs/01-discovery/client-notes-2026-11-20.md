# Client Notes — 2026-11-20

Source: client brief (original, Banglish, translated to English below). Ref ID: `SRC-001`.

## Original (verbatim)

> akhon ami 1ti website banate cai jetir maddome ami furniture resal and new furneture seal korbo. role 2ti thakbe. backend nodejs expressjs type script and prisma orm , mongobd. website and admin dashbaord thakbe. admin dashboard theke website manage kora hoeb sundor and cleen up hote hobe. role thakbe admin and customer. authentication system thakeb otp verification and mail send ar jonno nodemailer use kora hobe ui ar jonno shadcn ui/ dasy ui/ magic ui agulo us ekorte paro and fremer motion aos gsap agulo animation ar jonno use koro. kono payment getway thakbe na just cash on delivery hobe mvp version a notificatin thakbe socket io use kore. kono radis and kafka erc agulo use kora hobe na mvp te. sundor dekhe color pic korio and language 2ta hobe en and ar.

## Translated requirements

| # | Statement | Ref |
|---|-----------|-----|
| 1 | Build a website to sell **resale (used)** furniture and **new** furniture. | SRC-001.1 |
| 2 | Two roles: **admin** and **customer**. | SRC-001.2 |
| 3 | Backend: Node.js + Express.js + TypeScript + Prisma ORM + MongoDB. | SRC-001.3 |
| 4 | Two front-ends: public **website** and **admin dashboard**. | SRC-001.4 |
| 5 | The website is managed from the admin dashboard; UI must be beautiful and clean. | SRC-001.5 |
| 6 | Authentication with **OTP verification**; email via **Nodemailer**. | SRC-001.6 |
| 7 | UI kits allowed: shadcn/ui, daisyUI, Magic UI. | SRC-001.7 |
| 8 | Animation: Framer Motion, AOS, GSAP. | SRC-001.8 |
| 9 | **No payment gateway** — Cash on Delivery only (MVP). | SRC-001.9 |
| 10 | Real-time notifications via **Socket.IO** (MVP). | SRC-001.10 |
| 11 | No Redis, Kafka, or similar infra in MVP. | SRC-001.11 |
| 12 | Pick an attractive colour palette. | SRC-001.12 |
| 13 | Two languages: **English (en)** and **Arabic (ar)**. | SRC-001.13 |

## Not stated (see `open-questions.md` and `05-delivery/blockers.md`)

Still open: deployment/SMTP target (B-005), brand (B-006), guest checkout (B-007), OTP on login (B-009). Resale source, image storage, cancellation and framework choice were answered (SRC-002); market, currency, delivery cities, phone format and default locale were answered/corrected (SRC-003). Open: ZATCA e-invoicing (B-013), landline phones (B-014), digits and calendar in Arabic UI (B-015). Delivery fee and VAT are admin-managed (SRC-004, SRC-005). Open since SRC-006: backend hosting (B-017), repo layout (B-018), `EMAIL_LINK_TTL_SECONDS` (B-019), name fields (B-020), cron jobs (B-021).

## Client answers — 2026-11-20 (SRC-002)

Answers to blockers (CR-001).

| # | Statement | Ref | Resolves |
|---|-----------|-----|----------|
| 1 | Only the store lists resale items. No "Sell to us" feature in the MVP. | SRC-002.1 | B-001 |
| 2 | ~~Currency and delivery area~~ — **superseded by SRC-003** (client correction, same day). | SRC-002.2 | B-002 |
| 3 | Cloudinary is approved for image storage. | SRC-002.3 | B-004 |
| 4 | Customers can cancel only while the order is PENDING. | SRC-002.4 | B-008 |
| 5 | Next.js for web and Vite + React for admin is approved. | SRC-002.5 | B-010 |

## Client correction — 2026-11-20 (SRC-003)

Correction to B-002 (CR-002): the store is for **Saudi Arabia**. Supersedes SRC-002.2.

| # | Statement | Ref | Resolves |
|---|-----------|-----|----------|
| 1 | Currency is SAR (Saudi Riyal). Prices are stored as integer halalas (1 SAR = 100 halalas) and formatted with `Intl` for `en-SA` and `ar-SA`. | SRC-003.1 | B-002 |
| 2 | Delivery is to Saudi Arabian cities only (e.g. Riyadh, Jeddah, Mecca, Medina, Dammam, Khobar). The city list is managed by an admin from Site Settings, with an active toggle per city. | SRC-003.2 | B-002 |
| 3 | Phone numbers use the Saudi format (+966) and are validated in the address and profile forms. | SRC-003.3 | B-002 |
| 4 | Default locale is `ar` (Arabic, RTL); `en` is the second language. | SRC-003.4 | — |

## Client answers — 2026-11-20 (SRC-004)

CR-003. Answer to the delivery-fee and VAT questions.

> delivery fee and vats are handel form admin dashboard

| # | Statement | Ref | Resolves |
|---|-----------|-----|----------|
| 1 | The delivery fee is managed by an admin from the admin dashboard (not fixed in code or config). | SRC-004.1 | B-003, B-011 |
| 2 | VAT is managed by an admin from the admin dashboard (not fixed in code or config). | SRC-004.2 | B-012 |

Not covered by this answer: whether VAT applies to the delivery fee (answered in SRC-005) and ZATCA e-invoicing rules (B-013, still open).

## Client answers — 2026-11-20 (SRC-005)

CR-004. Answers to the delivery-fee/VAT follow-up questions, plus a new rule. Resolves B-016 and confirms the earlier pending changes (SRC-002, SRC-003, ADR-007, ADR-008, ADR-009).

| # | Statement | Ref | Resolves |
|---|-----------|-----|----------|
| 1 | Rule: VAT and delivery charges are set by the admin in Site Settings; when not set they default to 0. `vatRate` default 0 (no VAT line anywhere when 0); `deliveryFee` default 0 (shows "Free delivery"); `freeDeliveryThreshold` optional, default empty. | SRC-005.1 | B-003, B-012 |
| 2 | Per-city fee override is wanted, admin-controlled. No override → base `deliveryFee`; unset → 0. | SRC-005.2 | B-011 |
| 3 | "Apply VAT to delivery fee" is an admin toggle in Site Settings, default true; only effective when `vatRate` > 0. | SRC-005.3 | B-016 |
| 4 | Keep `expectedTotal` + 409 `PRICE_CHANGED`. | SRC-005.4 | — |
| 5 | Every order stores a snapshot of `vatRate`, `vatAmount` and `deliveryFee`; later setting changes never change past orders. | SRC-005.5 | — |
| 6 | Client/team confirm all earlier unconfirmed changes (Saudi market, Cloudinary, ADR-007/008/009). | SRC-005.6 | — |

## Team/client change — 2026-11-20 (SRC-006)

CR-005. Image storage change and adoption of the backend `.env` as the real environment.

| # | Statement | Ref | Resolves |
|---|-----------|-----|----------|
| 1 | Use Cloudflare R2 (S3-compatible API, presigned PUT from the admin browser) instead of Cloudinary. Key `furnixa/{env}/{yyyy}/{mm}/{uuid}.{ext}`; jpeg/png/webp, max 5 MB, URL valid 5 min; `ImageAsset {key, url, width?, height?, alt?}`; delete the R2 object on image removal / product deletion (log failures). | SRC-006.1 | B-004 (changed) |
| 2 | Adopt the backend `.env` keys: ports API 4100 / web 3100 / admin 3101; argon2 instead of bcrypt; refresh TTL 30 days; login lockout; `MAX_ACTIVE_SESSIONS`; CSRF for cookie requests; Sentry (off when `SENTRY_DSN` empty). | SRC-006.2 | — |
| 3 | Not decided, raised as blockers: Vercel hosting vs Socket.IO (B-017), pnpm monorepo vs three repos (B-018), `EMAIL_LINK_TTL_SECONDS` (B-019), `firstName`/`lastName` (B-020), `CRON_SECRET` jobs (B-021). | SRC-006.3 | — |

## Client answers and hosting decision — 2026-11-20 (SRC-007)

CR-006. Answers to B-017…B-021 and the final hosting decision (replaces the earlier "Option A" answer).

| # | Statement | Ref | Resolves |
|---|-----------|-----|----------|
| 1 | Backend, web and admin all deploy on Vercel. Vercel Functions support WebSockets natively (GA, Fluid Compute); Socket.IO works with `transports: ['websocket']`; connections close at the function duration limit (about 5 min); Vercel runs multiple instances. Socket.IO in its own function (`api/socket-io.ts`, path `/api/socket-io/socket.io`); `@socket.io/mongo-adapter` + `mongo-emitter` (no Redis); clients: websocket transport, reconnect with backoff, refresh token before reconnect, re-fetch unread count and latest notifications after each reconnect; rate limiting in a MongoDB collection with a TTL index; Vercel Cron + `CRON_SECRET` for `/internal/cron/cleanup` (OTPs, refresh tokens, old adapter documents); `TRUST_PROXY=1` in production; Prisma singleton and Atlas pool settings; ADR-005 superseded; `vercel.json` for the backend. | SRC-007.1 | B-017, B-021, B-005 (hosting) |
| 2 | Three separate repos with `npm` (B-018). `OTP_TTL_SECONDS=600` replaces `EMAIL_LINK_TTL_SECONDS` (B-019). | SRC-007.2 | B-018, B-019 |
| 3 | `firstName` + `lastName` (B-020). | SRC-007.3 | B-020 |
| 4 | Atlas and Gmail SMTP are used instead of Docker. | SRC-007.4 | B-005 (SMTP) |
| 5 | Assumptions accepted: lockout per account; oldest session revoked at `MAX_ACTIVE_SESSIONS`; `REFRESH_TOKEN_PEPPER` as HMAC key. | SRC-007.5 | — |
