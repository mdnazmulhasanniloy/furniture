# Admin Dashboard (admin) Tasks

Done = linked acceptance criteria covered by passing tests (Vitest + Testing Library, Playwright for flows), UI works in en (LTR) and ar (RTL).

### T-060 Bootstrap Vite + shadcn + theme + i18n/RTL + dark mode · todo
- Req: I18N-01 · Depends: — · Docs: `design-system.md`, `adr/ADR-002`, `adr/ADR-004` · Done: dev port 3101 (`ADMIN_URL`), API base from `VITE_API_URL` (:4100); CSRF token fetched before refresh/logout (ADR-011).

### T-061 Admin auth + protected routes + shell · todo
- Req: AUTH-02, AUTH-06 · Depends: T-060, backend T-005 · Docs: `screen-specs.md#A-06`
- Done: CUSTOMER login rejected with message; refresh flow; collapsible sidebar mirrors in RTL; RATE_LIMITED and ACCOUNT_LOCKED errors show a localized en/ar message using the Retry-After value (for example 'Try again in 12 minutes').

### T-062 Overview · todo — Req: ADM-01 · Depends: T-061, backend T-018
### T-063 Categories · todo — Req: ADM-03 · Depends: T-061, backend T-009
### T-064 Products list + editor + image uploader · todo
- Req: ADM-02, I18N-02 · Depends: T-063, backend T-010, backend T-008 · Docs: `adr/ADR-010` (presign via `POST /admin/uploads/presign`, then PUT to R2)
- Done: en/ar tabs, publish blocked until both languages filled, drag-sort images, unsaved-changes guard. Uploader: validates type (jpeg/png/webp) and size (≤ 5 MB) before presigning, reads width/height, PUTs directly to `uploadUrl` with matching `Content-Type`, shows progress and error states, saves `{key, width, height, alt}`; removing an image only drops it from the form until save. Tests named `ADM-02` mock `fetch`/XHR.
### T-065 Orders · todo — Req: ADM-04 · Depends: T-061, backend T-014 · Done: only allowed next statuses shown; print invoice (both locales) shows the order's snapshot: delivery fee ("Free delivery" when 0), and the VAT breakdown + registration number only when the snapshot `vatRate` > 0; tests named `ADM-04`.
### T-066 Customers · todo — Req: ADM-05 · Depends: T-061, backend T-017
### T-067 Banners · todo — Req: ADM-06 · Depends: T-064 (uploader), backend T-011 · Done: desktop/mobile images use the R2 presign uploader (ADR-010); tests named `ADM-06` with mocked upload calls; removing a banner image is reflected after save.
### T-068 Home sections (dnd-kit) · todo — Req: ADM-07 · Depends: T-067
### T-069 Static pages (Tiptap per locale) · todo — Req: ADM-08 · Depends: T-061, backend T-011
### T-070 Site settings (General, Social, SEO) · todo — Req: ADM-09 · Depends: T-061, backend T-011 · Done: ar/en tabs, default locale ar, currency read-only SAR.
### T-071 Live notifications · todo — Req: ADM-10, NOTIF-02, NOTIF-03 · Depends: T-061, backend T-016 · Done: same socket client contract as web T-040 (websocket only, backoff, token refresh before reconnect, re-fetch `GET /notifications` after every connect); toast + optional sound on new order; bell; list page; test `NOTIF-02`: an order notification created while disconnected appears after reconnect.
### T-072 Admin users · todo — Req: ADM-11 · Depends: T-061, backend T-017
### T-073 Settings → Delivery (fee, threshold, cities) · todo
- Req: ADM-13, ADM-14 · Depends: T-070, backend T-021, backend T-022 · Docs: `screen-specs.md#A-05`
- Done: base fee (SAR input, default 0), optional free-delivery threshold (empty = none), cities table (ar/en names, code, fee override empty = base fee, active toggle, reorder, add dialog; last active toggle disabled; no delete); tests named `ADM-13` / `ADM-14`: empty override saves null, negative fee rejected, saving leaves existing orders untouched.
### T-074 Settings → VAT · todo
- Req: ADM-14 · Depends: T-070, backend T-021
- Done: `vatRate` % (default 0, 0-50, <= 2 decimals), "Apply VAT to delivery fee" switch (default on, disabled while rate is 0), "Prices include VAT" switch, 15-digit registration number validation, live example; tests named `ADM-14`: default state shows rate 0 and no example VAT, toggle persists, invalid rate/number rejected.
