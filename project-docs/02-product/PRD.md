# PRD — Furnixa (working name) · Furniture Marketplace MVP

Status: **DRAFT v0.7 — Vercel serverless hosting (ADR-012), `firstName`/`lastName`, `OTP_TTL_SECONDS`; B-017…B-021 resolved (SRC-007)** · Date: 2026-11-20 · Source: `01-discovery/client-notes-2026-11-20.md` (SRC-001…SRC-007)

## 1. Summary

A bilingual (Arabic default / English) online store for **Saudi Arabia** that sells **new** and **resale (pre-owned)** furniture. Customers browse, add to cart and order with **Cash on Delivery**. Admins manage products, orders, customers and all website content from an admin dashboard. Real-time notifications via Socket.IO; email OTP via Nodemailer. Prices are in **SAR** and delivery is to **Saudi cities enabled by an admin** (SRC-003.1, SRC-003.2). The default language is Arabic (RTL) with English second (SRC-003.4). All resale stock is listed by the store itself (SRC-002.1).

## 2. Goals

- G1. Customers can find and order new or resale furniture in under 3 minutes.
- G2. Admins can change any customer-visible content without a developer.
- G3. Full parity between Arabic (RTL, default) and English (LTR).
- G4. Beautiful, clean, animated UI that stays fast (LCP < 2.5 s on 4G).

## 3. Non-goals (MVP)

Payment gateway, Redis/Kafka/queues, multi-vendor marketplace, mobile app, SMS OTP, reviews/ratings, wishlist, coupons, multi-currency, live chat, customer "Sell to us" / resale submissions (SRC-002.1), delivery outside Saudi Arabia or to cities not enabled in Site Settings (SRC-003.2). (SRC-001.9, SRC-001.11)

## 4. Roles

`ADMIN`, `CUSTOMER` — see `roles-permissions.md`. (SRC-001.2)

## 5. Requirements

Format: ID · user story · acceptance criteria (Given/When/Then) · out of scope · source.
Status values: `draft`, `pending-client` (blocked by a question), `approved`.

### 5.1 Authentication (AUTH) — SRC-001.6

**AUTH-01 Register with email OTP** · draft
As a visitor, I want to sign up with first name, last name, email and password and verify my email with an OTP, so that my account is trusted.
- Given a new email, When I submit the register form, Then an unverified account is created and a 6-digit OTP is emailed (valid `OTP_TTL_SECONDS`, default 600 = 10 min).
- Given a correct, unexpired OTP, When I submit it, Then my account becomes verified and I am logged in.
- Given a wrong OTP 5 times, When I submit again, Then the OTP is invalidated and I must request a new one.
- Given an email that is already verified, When I register, Then I get "email already in use" (409).
- Out of scope: social login, phone/SMS OTP.

**AUTH-02 Login** · draft
- Given a verified account, When I submit correct email + password, Then I receive an access token and an httpOnly refresh cookie.
- Given an unverified account, When I log in, Then a new OTP is sent and I am redirected to the verify screen.
- Given a blocked account, When I log in, Then I get 403 "account blocked".
- Given `LOGIN_MAX_FAILURES` (default 5) consecutive failed logins for an account, When I try again within `LOGIN_LOCKOUT_SECONDS` (default 900), Then I get 429 `ACCOUNT_LOCKED`; a successful login resets the counter.
- Given 10 failed attempts in 15 min from one IP, Then further attempts get 429 (IP rate limiter with a MongoDB-backed store, ADR-012).
- Given I already have `MAX_ACTIVE_SESSIONS` (default 5) active sessions, When I log in, Then my oldest session is revoked (ADR-011).

**AUTH-03 Forgot / reset password via OTP** · draft
- Given a registered email, When I request reset, Then an OTP (purpose `RESET_PASSWORD`) is emailed; the response is identical for unknown emails.
- Given a valid OTP and new password (min 8 chars, 1 letter + 1 number), When I submit, Then the password is changed, all refresh tokens are revoked and access tokens issued before the reset stop working; I am not logged in by the reset and must log in.
- Given a successful reset, Then a "Your password was changed" email (no code, no password) is sent in my `preferredLocale` (en/ar), telling me to contact support if it was not me. *(Source: owner decision 2026-11-21.)*

**AUTH-04 Resend OTP** · draft
- Given I requested an OTP, When I click resend before 60 s, Then the button is disabled with a countdown and the API returns 429.
- Given more than 5 OTPs in one hour for the same email, Then the API returns 429.

**AUTH-05 Session & logout** · draft
- Access token (JWT, 15 min) in memory; refresh token (30 days, rotated, hashed in DB) in httpOnly, Secure, SameSite cookie (settings from env, ADR-011).
- Given a cookie-authenticated call (`/auth/refresh`, `/auth/logout`) without a valid `X-CSRF-Token`, Then 403 `CSRF_INVALID`.
- When I log out, Then the refresh token is revoked and the cookie cleared.

**AUTH-06 Role-based access** · draft
- Given a CUSTOMER token, When calling any `/api/v1/admin/*` route, Then 403.
- Given no token, When opening the admin app, Then I am redirected to admin login.
- Admin accounts are created by seed script or by another admin; no public admin signup.

### 5.2 Profile (PROF)

**PROF-01 Profile** · draft — View/edit first name, last name, phone, avatar, preferred language (default `ar`). Changing email is out of scope.
- Avatar editing is delivered by T-028; until then `PATCH /me` rejects `avatar` with 422.
- Phone must be a valid Saudi mobile number (NFR-06); Given an invalid number, When I save, Then the field shows a localized error and the API returns 422 `VALIDATION_ERROR`.
**PROF-02 Address book** · draft — Add/edit/delete addresses (label, full name, phone, city, area, street, notes); one default. Given no address, When checking out, Then I must add one inline.
- City is chosen from the **active delivery cities** (ADM-13, SRC-003.2), stored as `cityCode`. Given an unknown or inactive city, When the address is saved, Then the API returns 422 `OUT_OF_DELIVERY_AREA`. Area and street stay required.
- Phone must be a valid Saudi mobile number (NFR-06, SRC-003.3); the form shows a fixed `+966` prefix.
- Given a saved address whose city was later deactivated, Then it stays visible flagged "Not deliverable" and the customer must pick an active city before ordering to it.

### 5.3 Catalog (CAT, PROD) — SRC-001.1

**CAT-01 Categories** · draft — Customers see active categories (name + image, localized) on home and in the shop filter; categories may have one level of sub-categories.

**PROD-01 Product listing** · draft
- Filters: category, type (`NEW` / `RESALE`), condition grade, price range, material, in-stock; sort: newest, price ↑/↓, featured.
- Search by name/description in the active locale.
- Paginated (24 per page), URL reflects filters (shareable).
- Given a resale product, Then its card shows a "Pre-owned · {grade}" badge; new products show a "New" badge.

**PROD-02 Product detail** · draft
- Image gallery (zoom on desktop, swipe on mobile), localized title/description, price, compare-at price (optional), condition + condition notes (resale), dimensions (W×D×H cm), material, colour, stock status, delivery note ("Delivery to selected Saudi cities").
- Prices are shown in SAR via the shared `formatPrice` helper (`Intl.NumberFormat` for `en-SA` / `ar-SA`; rules in `design-system.md` §8, ADR-008). A small "Incl. VAT" / "+ VAT" note next to the price follows the admin VAT setting (ADM-14); it is hidden when `vatRate` is 0.
- Given stock = 0, Then "Add to cart" is disabled and shows "Sold out".
- Related products from the same category.

### 5.4 Cart & Orders (CART, ORD) — SRC-001.9

**CART-01 Cart** · draft
- Guests keep a cart in localStorage; on login it merges into the server cart.
- Quantity cannot exceed stock; resale items max qty = stock (usually 1).
- Cart shows subtotal, delivery fee, VAT line (only when `vatRate` > 0), total, all in SAR. Fee and VAT come from admin settings (ADM-14, ADR-009) and default to 0.
- Given the resolved delivery fee is 0, Then the cart, checkout and order show "Free delivery". Given `vatRate` is 0, Then no VAT line is shown on the cart, checkout, order or invoice.
- Given a delivery address is selected, Then the fee uses that city's override if set, else the base `deliveryFee`, else 0; Given no address yet, Then the base fee is shown and checkout recalculates once the address is chosen. Given a free-delivery threshold is set and the subtotal reaches it, Then the fee is 0.

**ORD-01 Checkout (COD)** · draft
- Given a logged-in customer with a non-empty cart and an address, When I place the order, Then the server re-validates price and stock, decrements stock atomically, creates an order with status `PENDING` and payment method `COD`, clears the cart and shows a success page with the order number (e.g. `FX-20261120-0042`).
- Given an item went out of stock, Then the order is rejected with a per-item error and nothing is decremented.
- Given an address whose city is unknown or no longer active, When I place the order, Then it is rejected with 422 `OUT_OF_DELIVERY_AREA` and nothing is decremented.
- Every order stores a snapshot of `deliveryFee` and `vat` (`vatRate`, `vatAmount`, `applyToDelivery`, `pricesIncludeVat`, registration number) as they were at placement, including when they are 0; later settings changes never alter past orders or invoices.
- Given the total the customer saw differs from the server-computed total (fee, VAT or toggle changed), When I place the order, Then it is rejected with 409 `PRICE_CHANGED` and nothing is decremented; the cart refreshes with the new totals.
- COD abuse limits (owner decision 2026-11-22): a customer can place at most 3 orders per hour (429 `RATE_LIMITED`) and have at most 3 `PENDING` orders at once (409 `TOO_MANY_PENDING_ORDERS`); the web shows localized messages for both.
- Out of scope: online payment, coupons.

**ORD-02 Order history** · draft — List of my orders with status chip; detail page shows items, address, totals and a status timeline.

**ORD-03 Cancel order** · draft (SRC-002.4)
- Given my order is `PENDING`, When I cancel, Then status becomes `CANCELLED` and stock is restored.
- Given my order is `CONFIRMED` or later, Then the Cancel button is hidden and the API returns 409 `INVALID_TRANSITION`.
- Admins can still cancel `PENDING` or `CONFIRMED` orders (ADM-04).

**ORD-04 Order emails** · draft — Email on order placed and each status change, in the customer's preferred language.

Order status flow: `PENDING → CONFIRMED → PROCESSING → OUT_FOR_DELIVERY → DELIVERED`; `PENDING|CONFIRMED → CANCELLED`. Payment status: `UNPAID → PAID` (set when DELIVERED).

### 5.5 Notifications (NOTIF) — SRC-001.10

**NOTIF-01 Customer live notifications** · draft — Given I am logged in on the website, When an admin changes my order status, Then I receive a toast within 2 s and the bell badge count increases, without refreshing.
- Given my socket was disconnected (network loss or the platform closing it at the function duration limit), When a notification is created and the socket reconnects, Then after the reconnect the bell count and list include it, and a toast shows it (grouped as "N new notifications" when more than 3). The client reconnects with backoff, refreshes the access token first, and re-fetches `GET /notifications` after every connect (ADR-012).
**NOTIF-02 Admin live notifications** · draft — Given an admin is logged in, When a new order is created, Then all online admins get a toast + sound (toggleable) and the bell count increases.
- Given an admin socket was disconnected when an order was placed, When it reconnects, Then the bell count and list include the new order notification (same reconnect rules as NOTIF-01).
**NOTIF-03 Notification centre** · draft — Persistent list (paginated), mark one/all as read, click navigates to the related order. Notifications created while offline appear on next login.

### 5.6 Internationalisation (I18N) — SRC-001.13

**I18N-01 Language switch & RTL** · draft (SRC-003.4) — Default locale is **`ar`**; switcher in header; URL prefix `/ar`, `/en`; Given I open `/`, Then I am redirected to `/ar` (or to `/en` if I previously chose English). `<html dir="rtl" lang="ar">` for Arabic; layouts mirror using logical CSS properties; numbers, prices and dates formatted with `Intl` for `ar-SA` / `en-SA` (`design-system.md` §8). Admin dashboard also supports ar/en and defaults to `ar`.
**I18N-02 Localized content** · draft — Every admin-editable customer-facing text (product, category, banner, page, section titles, delivery city names) has `ar` and `en` fields; admin form shows both side by side with Arabic first; `ar` required, `en` required before publishing. Missing text falls back to `ar` (ADR-006).
- Products (owner decision 2026-11-22, T-010): a `DRAFT` product requires **at least one locale non-empty** (trimmed) for `title` and for `description`; saving a product as `PUBLISHED` (create or update) requires **both `en` and `ar` non-empty** for `title` and `description`. Violations return 422 `VALIDATION_ERROR`.

### 5.7 UI quality (UI) — SRC-001.5, .7, .8, .12

**UI-01 Look & motion** · draft — Follows `03-design/design-system.md`. Framer Motion for component/page transitions, GSAP for the home hero/scroll storytelling, AOS for simple scroll reveals. `prefers-reduced-motion` disables non-essential animation.
**UI-02 Responsive & accessible** · draft — 360 px to 1920 px; WCAG 2.1 AA colour contrast; keyboard navigable; images have localized alt text.

### 5.8 Resale (RESALE)

Resale items are created by admins only (ADM-02, type `RESALE`). Customer submissions are **deferred, post-MVP** (SRC-002.1).

**RESALE-01 "Sell to us" request** · deferred (post-MVP, SRC-002.1) — ID reserved, not built.

### 5.9 Admin dashboard (ADM) — SRC-001.4, .5

**ADM-01 Overview** · draft — Cards: today's orders, pending orders, revenue (delivered, this month), low-stock count; chart of orders per day (30 days); latest 5 orders.
**ADM-02 Products** · draft — Table with search/filter/pagination; create/edit with localized fields, type NEW/RESALE, condition, price, compare-at price, stock, SKU, dimensions, material, colour, category, up to 8 images (drag to reorder; uploaded straight to Cloudflare R2 with presigned URLs, ADR-010; removing an image or deleting the product deletes the R2 object, and a failed delete is logged without failing the request), `isFeatured`, `status` (DRAFT/PUBLISHED/ARCHIVED). Soft delete (archive) if the product is in any order.
**ADM-03 Categories** · draft — CRUD, image, parent, sort order, active toggle; cannot delete a category with products.
**ADM-04 Orders** · draft — Filter by status/date/search; detail view; change status following the flow (invalid transitions rejected); internal note; printable invoice showing the VAT breakdown and the VAT registration number when set (ADM-14); ZATCA e-invoicing compliance (QR code, e-invoice format) pending B-013.
**ADM-05 Customers** · draft — List, view orders of a customer, block/unblock.
**ADM-06 Hero banners** · draft — CRUD, localized title/subtitle/CTA, desktop + mobile image, link, schedule (start/end), sort, active.
- Owner 2026-11-22 (T-011): banner images require localized alt text in both en and ar (UI-02); the CTA link must be a same-site path or an absolute https URL (protocol-relative, `javascript:`, `data:` and `http:` rejected).
**ADM-07 Home sections** · draft — Ordered list of sections the home page renders: `FEATURED_PRODUCTS`, `NEW_ARRIVALS`, `RESALE_PICKS`, `CATEGORY_GRID`, `PROMO_BANNER`, `TESTIMONIALS`; each with localized title, visibility, sort order, config (e.g. product ids, limit).
**ADM-08 Static pages** · draft — About, Contact, FAQ, Terms, Privacy; rich text per locale; slug; published toggle.
- Owner 2026-11-22 (T-011): page HTML is sanitised server-side on every write with an allowlist matching the Tiptap editor (ADR-013); a published page needs title and content in both locales, an unpublished one at least one (I18N-02).
**ADM-09 Site settings** · draft — Store name, logo, contact email/phone/address, social links, delivery fee and VAT (ADM-14), currency (fixed SAR, not editable — ADR-008), delivery cities (ADM-13), default locale (`ar` by default), SEO meta (localized). Contact phone is free text (the store may list a landline).
**ADM-10 Admin notifications** · draft — Same as NOTIF-02/03 in admin UI.
**ADM-11 Admin users** · draft — Admin can create another admin (OTP-verified email).
**ADM-12 Sell requests** · deferred (post-MVP, SRC-002.1) — ID reserved, not built.
**ADM-13 Delivery cities** · draft (SRC-003.2) — Managed in Settings → Delivery.
- Given I am an admin, When I add a city with an Arabic and an English name, Then it gets a unique `code` (slug) and appears in the list; I can rename, reorder and toggle it active/inactive. Cities cannot be deleted in the MVP.
- Given a city is inactive, Then it disappears from the customer address form, and checkout rejects addresses in it (422 `OUT_OF_DELIVERY_AREA`); existing orders are unchanged.
- Given only one city is active, When I try to deactivate it, Then the save is rejected (at least one active city is required).
- Seed: Riyadh, Jeddah, Mecca, Medina, Dammam, Khobar, all active.
- Each city has an optional delivery fee override (see ADM-14).

**ADM-14 Delivery fee & VAT settings** · draft (SRC-004.1, SRC-004.2, ADR-009) — Settings → Delivery and Settings → VAT.
- Rule: VAT and delivery charges are set only by an admin in Site Settings. Until set they are 0: `vatRate` 0, `deliveryFee` 0, `freeDeliveryThreshold` empty.
- Given I am an admin, When I set the base `deliveryFee`, the optional `freeDeliveryThreshold` and, per city, an optional fee override, Then new carts and orders use them immediately; existing orders are unchanged. Fees are entered in SAR and stored as halalas; negative values are rejected.
- Given a city has no override, Then it uses the base `deliveryFee`; Given that is also unset, Then the fee is 0 and "Free delivery" is shown.
- Given I open the VAT tab, Then I can set: `vatRate` in percent (0–50, up to 2 decimals, default 0), the toggle "Apply VAT to delivery fee" (default on; only effective when `vatRate` > 0), "prices include VAT" on/off (default on), and an optional VAT registration number (15 digits, starts and ends with 3).
- Given `vatRate` > 0 and prices include VAT, Then totals do not change and the VAT amount is shown as a breakdown; Given prices exclude VAT, Then VAT is added to the total.
- VAT base = subtotal, plus delivery fee when "Apply VAT to delivery fee" is on; rounded half up in halalas at order level (B-016 resolved).
- Given `vatRate` is 0, Then no VAT line appears on the cart, checkout, order or invoice.
- Seed: all values at their defaults (0 / empty); no VAT rate is pre-set.
- Out of scope: ZATCA e-invoicing (B-013), per-product VAT rates or exemptions.

## 6. Non-functional

- NFR-01 Security: helmet, CORS allow-list, zod validation on every input, argon2id password hashing (cost from env), OTPs stored hashed, login lockout, session cap, CSRF protection for cookie requests, rate limit on auth routes (MongoDB-backed store, ADR-012), no secrets in repo (ADR-011).
- NFR-02 Performance: API p95 < 300 ms for list endpoints at 1k products; Next.js image optimisation.
- NFR-03 SEO: SSR product pages, localized meta, `hreflang`, sitemap.
- NFR-04 Observability: structured logs (pino), request ids, central error handler, Sentry error reporting (disabled when `SENTRY_DSN` is empty).
- NFR-05 Data: MongoDB replica set (Atlas) — required for Prisma transactions (stock decrement).
- NFR-06 Saudi phone numbers: profile and address phones are Saudi mobile numbers, stored as E.164 `+9665XXXXXXXX`. Accepted input: `05XXXXXXXX`, `5XXXXXXXX`, `+9665XXXXXXXX`, `009665XXXXXXXX`; the server normalizes. One shared zod validator is used by web, admin and backend. Landlines are not accepted until B-014 is answered. (SRC-003.3, ADR-008)
- NFR-08 Hosting & operations: backend, web and admin run on Vercel; Socket.IO runs in its own function with `@socket.io/mongo-adapter` (no Redis); rate limits are stored in MongoDB; Vercel Cron calls `/internal/cron/cleanup` (protected by `CRON_SECRET`) daily; `TRUST_PROXY=1` in production; one PrismaClient per instance. (ADR-012)
- NFR-07 Money: all prices are integer halalas (1 SAR = 100 halalas); formatting only at the UI edge via `formatPrice`. Fee, VAT and totals are computed on the server only, in halalas. (SRC-003.1, ADR-008, ADR-009)

## 7. Release criteria (MVP)

All `draft`→`approved` requirements implemented with passing tests (see `05-delivery/test-plan.md`), en/ar parity check passed, client UAT sign-off.
