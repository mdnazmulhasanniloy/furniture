# Open Questions for Client

Each question is also logged as a blocker in `05-delivery/blockers.md`. Answers get filed into the PRD or an ADR.

1. ✅ **Resale source (B-001):** *Answered (SRC-002.1):* only the store lists resale items; no "Sell to us" in MVP.
2. ✅ **Currency & region (B-002):** *Answered (SRC-003):* Saudi Arabia; SAR; admin-managed Saudi delivery cities; +966 phones; default locale `ar`.
3. ✅ **Delivery fee (B-003, B-011):** *Answered (SRC-004.1):* managed by an admin in the dashboard. Per-city override wanted (SRC-005.2); defaults to 0 when unset (ADR-009).
4. ✅ **Image storage (B-004):** *Answered (SRC-002.3), changed (SRC-006.1):* Cloudflare R2 with presigned uploads (ADR-010); Cloudinary dropped.
5. **Hosting (B-005):** Preferred deployment (VPS, Render/Railway, Vercel for front-ends)?
6. **Brand (B-006):** Store name and logo? Working name: **Furnixa**.
7. **Guest checkout (B-007):** Must customers log in to order? Draft: yes, login required.
8. ✅ **Order cancellation (B-008):** *Answered (SRC-002.4):* customers can cancel only while `PENDING`.
9. ✅ **VAT (B-012):** *Answered (SRC-004.2):* managed by an admin in the dashboard (enabled, rate, prices include VAT, VAT number).
10. **Invoices (B-013):** Must invoices follow ZATCA e-invoicing (QR code, e-invoice format)? Draft: printable order summary with VAT breakdown (when VAT > 0) and VAT number, no ZATCA QR.
13. ✅ **VAT on delivery (B-016):** *Answered (SRC-005.3):* admin toggle "Apply VAT to delivery fee", default on.
11. **Phones (B-014):** Mobile only, or landlines too? Draft: mobile only.
12. **Digits & dates (B-015):** Western or Arabic-Indic digits, Gregorian or Hijri dates in the Arabic UI? Draft: Western digits, Gregorian.
14. **Backend hosting (B-017):** Vercel conflicts with Socket.IO and in-memory rate limiting. Options A–D in blockers.md.
15. **Repo layout (B-018):** three separate repos with `npm`, or a pnpm monorepo?
16. **`EMAIL_LINK_TTL_SECONDS` (B-019):** OTP expiry, or a link-based flow?
17. **Names (B-020):** `firstName` + `lastName` instead of `name`?
18. **Cron jobs (B-021):** which jobs does `CRON_SECRET` protect?
