# Data Model (MongoDB via Prisma 6)

Source of truth for the schema is this document; `backend/prisma/schema.prisma` must match it. Change this file first (Team rule 2).

## Composite types

- `LocalizedText { en String, ar String }`
- `PendingRegistration { passwordHash String, firstName String, lastName String, preferredLocale Locale }` — embedded in `Otp.pendingRegistration` (VERIFY_EMAIL only); applied to the `User` only when that OTP is verified (prevents pre-account takeover)
- `ImageAsset { key String, url String, alt LocalizedText?, width Int?, height Int? }` — `key` = R2 object key `furnixa/{env}/{yyyy}/{mm}/{uuid}.{ext}`; `url` = `R2_PUBLIC_BASE_URL + "/" + key` (recomputed by the server); `publicId` removed (ADR-010)
- `Dimensions { widthCm Float?, depthCm Float?, heightCm Float?, weightKg Float? }`
- `VatSetting { vatRate Float (percent 0–50, ≤2 decimals, default 0), applyToDelivery Boolean (default true), pricesIncludeVat Boolean (default true), registrationNumber String? (15 digits, `^3\d{13}3$`) }` (embedded in `SiteSetting.vat`)
- `OrderVat { vatRate Float, vatAmount Int (halalas), applyToDelivery Boolean, pricesIncludeVat Boolean, registrationNumber String? }` (immutable snapshot on each order)
- `DeliveryCity { code String, name: LocalizedText, isActive Boolean, sortOrder Int, deliveryFee Int? (halalas; null = use SiteSetting.deliveryFee) }` (embedded in `SiteSetting.deliveryCities`; `code` is a unique, immutable slug)
- `AddressSnapshot { fullName, phone, cityCode, city: LocalizedText, area, street, notes? }` (copied into orders; `phone` is E.164 `+9665XXXXXXXX`)

## Enums

`Role { ADMIN CUSTOMER }` · `Locale { en ar }` · `OtpPurpose { VERIFY_EMAIL RESET_PASSWORD }` · `ProductType { NEW RESALE }` · `Condition { NEW LIKE_NEW GOOD FAIR }` · `ProductStatus { DRAFT PUBLISHED ARCHIVED }` · `OrderStatus { PENDING CONFIRMED PROCESSING OUT_FOR_DELIVERY DELIVERED CANCELLED }` · `PaymentMethod { COD }` · `PaymentStatus { UNPAID PAID }` · `NotificationType { ORDER_PLACED ORDER_STATUS NEW_ORDER SYSTEM }` · `SectionType { FEATURED_PRODUCTS NEW_ARRIVALS RESALE_PICKS CATEGORY_GRID PROMO_BANNER TESTIMONIALS }`

## Collections

| Model | Key fields | Indexes / notes |
|---|---|---|
| **User** | firstName, lastName, email (unique, lowercase), passwordHash, role, isVerified, isBlocked, failedLoginCount (default 0), lockedUntil?, passwordChangedAt? (nullable, set on password reset; `requireAuth` rejects access tokens whose `iat` is earlier, T-006), phone? (E.164 `+9665XXXXXXXX`), avatar?, preferredLocale (default `ar`), createdAt | unique email |
| **Otp** | email, purpose, codeHash (keyed HMAC over email + code), attempts, expiresAt, consumedAt?, createdAt, pendingRegistration: PendingRegistration? | index (email, purpose); wrong-code attempts are counted per email across its VERIFY_EMAIL rows (5 invalidates all); cooldown (60 s) and hourly cap (5) are computed from `createdAt`; `expiresAt` = now + `OTP_TTL_SECONDS` (default 600); expired/consumed rows removed by the cron cleanup (ADR-012) |
| **RefreshToken** | userId, familyId (set once at login, kept across rotations; identifies the session), tokenHash (keyed HMAC, ADR-011), expiresAt (30 days), revokedAt?, rotatedAt? (set together with `revokedAt` when the token is replaced by a refresh; absent for logout / session cap / reset / block), userAgent? | indexes userId, familyId; at most `MAX_ACTIVE_SESSIONS` unrevoked per user (the oldest session's family is revoked at login, in the same transaction as creating the new token). Presenting a rotated token again within 10 s of `rotatedAt` -> 401 `REFRESH_RACE`, nothing revoked; later -> the whole family is revoked (reuse detection). All of a user's tokens are revoked only on password reset and block. The CSRF token is `HMAC(CSRF_SECRET, familyId)`. Rows created before T-005 lack `familyId` and must be deleted (dev data only; nothing was deployed): `npm run migrate:refresh-family` (dry run) then `npm run migrate:refresh-family -- --confirm`, script `backend/scripts/migrations/2026-11-21-refresh-token-family.ts` |
| **Login lockout** | not a collection: the lockout counter is the `RateLimit` key `login:email:<hmac>` (`LOGIN_MAX_FAILURES` failures within `LOGIN_LOCKOUT_SECONDS`; reaching the limit moves `resetAt` to now + `LOGIN_LOCKOUT_SECONDS`). It is the single source of truth, so known and unknown emails behave identically. `User.failedLoginCount` (atomic `increment`) and `lockedUntil` are a mirror for admin visibility only | |
| **Address** | userId, label, fullName, phone (E.164 `+9665XXXXXXXX`), cityCode (must match an active `DeliveryCity.code` when written), area, street, notes?, isDefault | index userId |
| **Category** | name: LocalizedText, slug (unique), image?, parentId?, sortOrder, isActive | unique slug |
| **Product** | title, description: LocalizedText, slug (unique), sku?, type, condition, conditionNotes?: LocalizedText, price (Int, minor units), compareAtPrice?, stock, categoryId, images ImageAsset[], dimensions?, material?, color?, isFeatured, status, createdAt | indexes: (status, type), categoryId, isFeatured; text search on title.en/title.ar via `contains` (MVP) |
| **Cart** | userId (unique), items CartItem[] {productId, qty} , updatedAt | one per user |
| **Order** | orderNo (unique), userId, items OrderItem[] {productId, titleSnapshot: LocalizedText, imageSnapshot, unitPrice, qty, type, condition}, address: AddressSnapshot, subtotal, deliveryFee (resolved at placement), vat: OrderVat, total, paymentMethod=COD, paymentStatus, status, statusHistory StatusEvent[] {status, at, byUserId?, note?}, customerNote?, adminNote?, createdAt | index (userId, createdAt), status |
| **Notification** | userId (admin-wide events fan out to one row per admin), type, title, body: LocalizedText, link?, data Json?, readAt?, createdAt | index (userId, readAt) |
| **Banner** | title, subtitle, ctaLabel: LocalizedText, ctaHref, imageDesktop, imageMobile: ImageAsset, startsAt?, endsAt?, sortOrder, isActive | |
| **HomeSection** | type, title: LocalizedText, subtitle?, config Json (e.g. {productIds?, limit}), sortOrder, isVisible | |
| **Page** | slug (unique), title, content (HTML): LocalizedText, metaTitle?, metaDescription?, isPublished | |
| **SiteSetting** | singleton key="default": storeName: LocalizedText, logo?, contactEmail, contactPhone, address: LocalizedText, socials Json, deliveryFee Int (base fee, halalas, default 0), freeDeliveryThreshold Int? (default empty), vat: VatSetting (defaults: vatRate 0, applyToDelivery true, pricesIncludeVat true), currency String (fixed "SAR", ADR-008), deliveryCities DeliveryCity[] (seeded: riyadh, jeddah, mecca, medina, dammam, khobar), defaultLocale (default `ar`), seo Json | unique key; at least one city active; cities are never deleted, only deactivated |
| **RateLimit** | key (unique, stored as `rl:{scope}:{kind}:{id}`, e.g. `rl:login:ip:203.0.113.7`, `rl:login:email:<hmac>`, `rl:otp:email:<hmac>`), hits Int, resetAt DateTime | **TTL index** `{resetAt: 1}, expireAfterSeconds: 0` created at start-up by `ensureIndexes()` (Prisma cannot declare TTL indexes, so the schema has no `@@index` on `resetAt`). One atomic `findAndModify` upsert with an **update pipeline** (ADR-012): new or `resetAt <= now` → `hits = 1`, `resetAt = now + window`; else `hits = hits + 1` (TTL deletion lags up to ~60 s, so the window check cannot rely on it); `now` comes from the app. IPv6 clients are keyed by their /64 prefix, IPv4-mapped IPv6 by the IPv4 address; emails are lowercased, trimmed and HMAC-SHA256'd with `REFRESH_TOKEN_PEPPER` (no plain emails stored) |
| **Counter** | name (unique), seq | used for `orderNo` daily sequence via atomic `upsert` + `increment` |

Money is stored as **integers in minor units** (**halalas**, 1 SAR = 100 halalas) to avoid float errors; currency is SAR (ADR-008). Delivery fee and VAT are admin settings (ADR-009). Defaults are 0 (no fee, no VAT). Delivery fee = 0 if the threshold is set and met, else city override, else base fee. Per order, with `bp = round(vatRate × 100)` and `base = subtotal + (applyToDelivery ? deliveryFee : 0)`: `vatRate = 0` → `vatAmount = 0`; inclusive `vatAmount = round(base × bp / (10000 + bp))`, `total = subtotal + deliveryFee`; exclusive `vatAmount = round(base × bp / 10000)`, `total = subtotal + deliveryFee + vatAmount`; rounded half up, once per order. `Order.deliveryFee` and `Order.vat` are snapshots and are never recomputed. ZATCA e-invoice data is not modelled (pending B-013).

## Deferred (post-MVP, SRC-002.1)
`SellRequest` — userId, title, description, images, expectedPrice, city, status {NEW CONTACTED ACCEPTED REJECTED}, adminNote. **Not in the schema**; customer submissions were declined for the MVP.

Password hashes are argon2id (ADR-011). `User` has `firstName` and `lastName` (B-020, SRC-007.3); the display name is `firstName + " " + lastName`; `Address.fullName` (the recipient) is separate.

## Collections outside Prisma (ADR-012)
`socket.io-adapter-events` — owned by `@socket.io/mongo-adapter` / `mongo-emitter` (native driver, not in `schema.prisma`). TTL collection: documents carry `createdAt`; TTL index `{createdAt: 1}, expireAfterSeconds: SOCKET_ADAPTER_TTL_SECONDS` (3600). Old documents are also deleted by the cron cleanup.
