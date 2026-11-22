# Website (web) Tasks

Done = linked acceptance criteria covered by passing tests (Vitest + Testing Library for components, Playwright for flows) **in both `en` and `ar`**.

### T-030 Bootstrap Next.js + design tokens + i18n/RTL · todo
- Req: I18N-01, UI-01 · Depends: — · Docs: `03-design/design-system.md`, `adr/ADR-002`, `adr/ADR-004`
- Done: dev port 3100 (`next dev -p 3100`, `STOREFRONT_URL`); `images.remotePatterns` allows the `R2_PUBLIC_BASE_URL` host; Next.js 15 App Router, Tailwind v4 tokens from design system, shadcn init, fonts (Fraunces/Manrope/Noto Kufi Arabic/IBM Plex Sans Arabic), `next-intl` with `/en` `/ar`, `<html dir>` correct (Playwright check), `messages/en.json` + `ar.json` key parity script.
- Note (backend T-011): the `/api/revalidate` route receives `{tags}` with `x-revalidate-secret` (must equal backend `REVALIDATE_SECRET`). Tag pages that show prices, VAT or delivery info with the `settings` tag as well as their own tag — a settings change revalidates `settings`, `home` and `products` (owner 2026-11-22).

### T-031 API client + auth state + token refresh · todo
- Req: AUTH-05 · Depends: T-030, backend T-005
- Note (backend T-005): refresh must be single-flight (one in-flight refresh shared by all requests); on 401 `REFRESH_RACE` retry once with the new cookie (do not log out); the CSRF token from `GET /auth/csrf` is bound to the session and survives rotations (fetch it after login, cache it); show a localized message for `INVALID_CREDENTIALS`.
- Done: fetch wrapper with `Accept-Language`, 401 → single refresh retry; TanStack Query provider; auth store; RATE_LIMITED and ACCOUNT_LOCKED errors show a localized en/ar message using the Retry-After value (for example 'Try again in 12 minutes').

### T-032 Layout shell · todo
- Req: I18N-01, UI-02 · Depends: T-031 · Docs: `screen-specs.md#W-01`
- Done: header (mega-menu, search, language switch, cart, bell, account), mobile nav sheet, footer from settings; mirrors in RTL.

### T-033 Home page · todo
- Req: ADM-06, ADM-07, UI-01 · Depends: T-032, backend T-011
- Done: renders banners + sections in API order; GSAP hero + pinned "How resale works"; Magic UI marquee/bento; reduced-motion respected; empty sections hidden.

### T-034 Shop + category listing · todo
- Req: PROD-01, CAT-01 · Depends: T-032, backend T-010
- Done: all filters in URL; mobile filter sheet; badges per type/condition; empty state; pagination.

### T-035 Product detail · todo
- Req: PROD-02 · Depends: T-034
- Done: gallery, condition panel, specs, sold-out state, related; SSR + metadata.
- Note (backend T-011): tag the page with `product:{slug}`, `products` AND `settings` — VAT and delivery display change when an admin edits settings, and a settings write revalidates the `settings` tag (owner 2026-11-22).

### T-036 Cart (guest + server, drawer, merge) · todo
- Req: CART-01 · Depends: T-035, backend T-012
- Done: localStorage guest cart; merge on login; qty capped; free-delivery progress; fly-to-cart animation.
- Backend T-012 notes (2026-11-22): clear the localStorage cart **only after a successful `POST /cart/merge` response** (merge is idempotent, so retrying after a failure is safe). When `GET /cart?addressId=` returns `address.isDeliverable: false`, show "We don't deliver to this city" and disable checkout. Render per-line `issue` (UNAVAILABLE / OUT_OF_STOCK / QTY_REDUCED / PRICE_CHANGED with old vs new price). On 409 `CART_CONFLICT`, retry the write once.

### T-037 Auth pages · todo
- Req: AUTH-01..04 · Depends: T-031, backend T-004..T-006
- Done: register → OTP (InputOTP, paste, 60 s resend countdown) → logged in; login unverified redirect; forgot/reset. When verify-otp returns OTP_EXPIRED and resend cannot help (no pending row), the verify screen re-submits the register request with the form data kept in memory (never in localStorage), shows 'A new code was sent', and resets the countdown. Test in en and ar. Reset screen (backend T-006): `POST /auth/reset-password` answers every failure to match a code (wrong, expired, used, unknown email) with the same 400 `OTP_INVALID`, so show "invalid or expired code" with a link to request a new one; success is a 200 message and NOT a login, so send the user to the login screen; a 429 `RATE_LIMITED` shows the `Retry-After` wait.

### T-038 Checkout + success · todo
- Req: ORD-01, PROF-02 · Depends: T-036, T-037, backend T-013
- Done: inline address add; COD only; per-item stock error display; success page. An address with `isDeliverable: false` (`api-spec.yaml#Address`) is shown as "Not deliverable" and cannot be chosen; the customer picks an active city first. The field is a hint only: placing the order still re-checks the city on the server (422 `OUT_OF_DELIVERY_AREA`) and the UI handles that error. Backend T-012 note (2026-11-22): `GET /cart?addressId=` also returns `address.isDeliverable`; when false, show "We don't deliver to this city" and disable the place-order button.
- Backend T-013 notes (owner, 2026-11-22): `POST /orders` requires an `Idempotency-Key` header — generate the UUID **once per checkout attempt and reuse it on retry** (double-click and network retries then return the same order as 200; a new attempt after an error that changes the request, e.g. a new address or refreshed totals, gets a fresh key — the old key with changed `addressId`/`expectedTotal` is rejected 422 `IDEMPOTENCY_MISMATCH`). `expectedTotal` is required (send the displayed total in halalas). Localized (en/ar) messages for 429 `RATE_LIMITED` ("max 3 orders per hour") and 409 `TOO_MANY_PENDING_ORDERS` ("you already have 3 pending orders").

### T-039 Account area · todo
- Req: PROF-01, PROF-02, ORD-02, ORD-03 · Depends: T-038
- Done: profile, addresses, orders list/detail with timeline. Phone input (SRC/T-020, `api-spec.yaml#SaudiPhoneInput`): apply the same normalisation as the backend (trim, Arabic-Indic and Extended Arabic-Indic digits to ASCII, strip spaces/dashes/dots/parentheses, reject >25 characters), then the same `x-canonical-pattern`; the backend validator is the authority. Test named `NFR-06` that reads the pattern from the spec. Addresses list shows "Not deliverable" from `isDeliverable: false` (no client-side city calculation); such an address stays editable and the customer must pick an active city. Avatar field: do not build it here; avatar editing is delivered by backend T-028 and `PATCH /me` rejects `avatar` with 422 until then.

### T-040 Live notifications · todo
- Req: NOTIF-01, NOTIF-03 · Depends: T-039, backend T-016
- Done: socket client per ADR-012 (`path: '/api/socket-io/socket.io'`, `transports: ['websocket']`, backoff reconnect, `auth` callback returns a fresh access token, refresh before reconnect); after every `connect` re-fetch `GET /notifications`; toast + bell badge; notifications page; tests: `NOTIF-01` unit test with a mocked socket — a notification created while disconnected is shown after reconnect (bell count, list, grouped toast); Playwright: admin status change → customer toast < 2 s while connected; forced disconnect then reconnect shows the missed notification.

### T-041 Static pages + SEO + revalidate route · todo
- Req: ADM-08, NFR-03 · Depends: T-033
- Done: `/[locale]/pages/[slug]`; localized metadata, `hreflang`, sitemap.xml, robots; `/api/revalidate` with secret.

### T-042 Motion & accessibility pass · todo
- Req: UI-01, UI-02 · Depends: T-030..T-041
- Done: axe checks pass on key pages in both locales; Lighthouse ≥ 90 perf/a11y on home + PDP (mobile).

### T-043 Saudi market formatting + default locale · todo
- Req: I18N-01, NFR-06, NFR-07 · Depends: T-030 · Docs: `design-system.md` §8, `adr/ADR-008`
- Done: next-intl `defaultLocale` ar (`/` -> `/ar`); shared `formatPrice(halalas, locale)` (SAR, `ar-SA` / `en-SA`, whole riyals without decimals, `<bdi>` in RTL), Saudi phone display helper and client-side phone validation matching backend (T-020: same normalisation, then the `x-canonical-pattern` read from `api-spec.yaml`); unit tests named `NFR-07` and `NFR-06`.

### T-044 Cart / checkout fee + VAT display · todo
- Req: CART-01, ORD-01 · Depends: T-036, T-038, backend T-021 · Docs: `screen-specs.md`
- Done: fee line shows "Free delivery" when 0; VAT line and "Incl. VAT / + VAT" note appear only when `vatRate` > 0; fee recalculates after address (city) selection; "Not deliverable" addresses blocked; `PRICE_CHANGED` shows "Totals were updated" and refreshes totals; component tests named `CART-01` / `ORD-01` cover the 0 defaults, city fallback and VAT toggle display (en LTR + ar RTL).
