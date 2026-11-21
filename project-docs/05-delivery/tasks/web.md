# Website (web) Tasks

Done = linked acceptance criteria covered by passing tests (Vitest + Testing Library for components, Playwright for flows) **in both `en` and `ar`**.

### T-030 Bootstrap Next.js + design tokens + i18n/RTL · todo
- Req: I18N-01, UI-01 · Depends: — · Docs: `03-design/design-system.md`, `adr/ADR-002`, `adr/ADR-004`
- Done: dev port 3100 (`next dev -p 3100`, `STOREFRONT_URL`); `images.remotePatterns` allows the `R2_PUBLIC_BASE_URL` host; Next.js 15 App Router, Tailwind v4 tokens from design system, shadcn init, fonts (Fraunces/Manrope/Noto Kufi Arabic/IBM Plex Sans Arabic), `next-intl` with `/en` `/ar`, `<html dir>` correct (Playwright check), `messages/en.json` + `ar.json` key parity script.

### T-031 API client + auth state + token refresh · todo
- Req: AUTH-05 · Depends: T-030, backend T-005
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

### T-036 Cart (guest + server, drawer, merge) · todo
- Req: CART-01 · Depends: T-035, backend T-012
- Done: localStorage guest cart; merge on login; qty capped; free-delivery progress; fly-to-cart animation.

### T-037 Auth pages · todo
- Req: AUTH-01..04 · Depends: T-031, backend T-004..T-006
- Done: register → OTP (InputOTP, paste, 60 s resend countdown) → logged in; login unverified redirect; forgot/reset. When verify-otp returns OTP_EXPIRED and resend cannot help (no pending row), the verify screen re-submits the register request with the form data kept in memory (never in localStorage), shows 'A new code was sent', and resets the countdown. Test in en and ar.

### T-038 Checkout + success · todo
- Req: ORD-01, PROF-02 · Depends: T-036, T-037, backend T-013
- Done: inline address add; COD only; per-item stock error display; success page.

### T-039 Account area · todo
- Req: PROF-01, PROF-02, ORD-02, ORD-03 · Depends: T-038
- Done: profile, addresses, orders list/detail with timeline.

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
- Done: next-intl `defaultLocale` ar (`/` -> `/ar`); shared `formatPrice(halalas, locale)` (SAR, `ar-SA` / `en-SA`, whole riyals without decimals, `<bdi>` in RTL), Saudi phone display helper and client-side phone validation matching backend (T-020); unit tests named `NFR-07` and `NFR-06`.

### T-044 Cart / checkout fee + VAT display · todo
- Req: CART-01, ORD-01 · Depends: T-036, T-038, backend T-021 · Docs: `screen-specs.md`
- Done: fee line shows "Free delivery" when 0; VAT line and "Incl. VAT / + VAT" note appear only when `vatRate` > 0; fee recalculates after address (city) selection; "Not deliverable" addresses blocked; `PRICE_CHANGED` shows "Totals were updated" and refreshes totals; component tests named `CART-01` / `ORD-01` cover the 0 defaults, city fallback and VAT toggle display (en LTR + ar RTL).
