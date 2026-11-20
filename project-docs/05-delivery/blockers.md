# Blockers

| ID | Question | Blocks | Draft assumption | Status | Resolution (→ PRD/ADR) |
|---|---|---|---|---|---|
| B-001 | Resale source: store-only listings, or customers can submit "Sell to us" requests? | RESALE-01, ADM-12 | Store lists all items; no customer submissions in MVP | resolved 2026-11-20 | SRC-002.1 → PRD §3, §5.8; RESALE-01/ADM-12 deferred |
| B-002 | Currency and delivery cities? | Settings, price display | Integer minor units; currency set in settings | resolved 2026-11-20 (corrected same day) | SRC-003.1–.3 → PRD §1, PROF-02, ORD-01, ADM-13, NFR-06/07; ADR-008 (SAR, Saudi cities managed by admin, +966 phones) |
| B-003 | Delivery fee model? | CART-01, ORD-01 | Flat fee + optional free threshold | resolved 2026-11-20 | SRC-004.1, SRC-005.1 → ADM-14; ADR-009 (admin-managed base fee, default 0, optional free threshold) |
| B-004 | Image storage: Cloudinary OK? | T-008, T-064, T-067 | Cloudinary | resolved 2026-11-20 (changed to Cloudflare R2 by SRC-006.1) | SRC-002.3 → ADR-007 (superseded); SRC-006.1 → ADR-010; integrations.md |
| B-005 | Hosting + SMTP provider? | Deployment | Vercel for all three apps (ADR-012); Atlas; Gmail SMTP for the MVP | resolved 2026-11-20 (provider revisited before launch volume) | SRC-007.1, SRC-007.4 → ADR-012, infra-deployment, integrations |
| B-006 | Brand name/logo | Design, emails | Working name "Furnixa" | open | |
| B-007 | Guest checkout allowed? | ORD-01 | Login required | open (assumption usable) | |
| B-008 | Customer cancellation rules? | ORD-03, T-015 | Only while PENDING | resolved 2026-11-20 | SRC-002.4 → PRD ORD-03 |
| B-009 | OTP on every login, or only for verification/reset? | AUTH-02 | Only verification/reset (ADR-003) | open | |
| B-010 | Confirm Next.js (web) + Vite React (admin) | ADR-002 | As proposed | resolved 2026-11-20 | SRC-002.5 → ADR-002 Accepted |
| B-011 | Is the delivery fee the same for all cities, or different per city? (related: B-003) | CART-01, ORD-01, ADM-09, ADM-13 | One flat fee (`deliveryFee`) for all cities; no per-city fee modelled | resolved 2026-11-20 | SRC-004.1 → ADM-13, ADM-14; SRC-005.2 → ADR-009 (base fee + optional admin-controlled per-city override; no override → base fee; unset → 0) |
| B-012 | Must displayed prices include 15% VAT? Should cart/order totals show a VAT line? | PROD-02, CART-01, ORD-01 | Prices are final customer prices; no VAT line or VAT field modelled | resolved 2026-11-20 | SRC-004.2 → ADM-14; SRC-005.1 → ADR-009 (admin sets `vatRate`, default 0; no VAT line when 0) |
| B-013 | Must invoices follow ZATCA e-invoicing (Fatoora) rules (QR code, e-invoice format)? The VAT registration number is now an admin setting printed on invoices (ADR-009). | ADM-04, T-065 (print invoice) | Invoice is a printable order summary with VAT breakdown (only when `vatRate` > 0) and registration number; no ZATCA QR / e-invoice | open | |
| B-014 | Are landline numbers accepted in address/profile phone fields, or mobile only? (added by CR-002) | PROF-01, PROF-02, NFR-06 | Mobile only (`+9665XXXXXXXX`) | open (assumption usable) | |
| B-015 | Arabic UI: Western digits (0-9) or Arabic-Indic digits (٠-٩)? Gregorian or Hijri dates? (added by CR-002) | design-system §8, I18N-01 | Western digits and Gregorian dates, pinned via Intl `u-nu-latn` / `u-ca-gregory` | open (assumption usable) | |
| B-016 | Does VAT apply to the delivery fee, or only to products? (added by CR-003) | ADM-14, ORD-01, CART-01 | VAT applies to subtotal + delivery fee (now an admin toggle) | resolved 2026-11-20 | SRC-005.3 → ADM-14, ADR-009 (admin toggle "Apply VAT to delivery fee", default true; only effective when `vatRate` > 0) |
| B-017 | Backend hosting vs Socket.IO and rate limiting. | NOTIF-01..03, AUTH-02, T-016, T-001 | — | resolved 2026-11-20 | SRC-007.1 → ADR-012 (supersedes ADR-005): all apps on Vercel; Socket.IO in its own function; `@socket.io/mongo-adapter` + `mongo-emitter`; MongoDB-backed rate limit store; Vercel Cron; clients reconnect and re-fetch. Replaces the earlier Option A answer. |
| B-018 | Repo layout: pnpm monorepo or three separate apps? | README, CLAUDE.md files, T-001, CI | — | resolved 2026-11-20 | SRC-007.2 → three separate apps with `npm`, `npm run seed` (the `.env` pnpm comment is dropped) |
| B-019 | Purpose of `EMAIL_LINK_TTL_SECONDS`. | AUTH-01, AUTH-03, AUTH-04 | — | resolved 2026-11-20 | SRC-007.2 → removed; OTP lifetime is `OTP_TTL_SECONDS=600` (10 min) |
| B-020 | `firstName` + `lastName` instead of `name`? | AUTH-01, PROF-01, ADM-05, T-002, T-004 | — | resolved 2026-11-20 | SRC-007.3 → `User.firstName`, `User.lastName` (customers and admins); `name` removed; `Address.fullName` (recipient) unchanged |
| B-021 | Which cron jobs does `CRON_SECRET` protect? | data-model (Otp cleanup), T-025 | — | resolved 2026-11-20 | SRC-007.1 → ADR-012: Vercel Cron `GET /internal/cron/cleanup` (OTPs, refresh tokens, socket adapter documents), daily; replaces `node-cron` |
