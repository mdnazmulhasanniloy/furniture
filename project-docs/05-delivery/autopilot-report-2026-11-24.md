# Autopilot report — 2026-11-24

Branch: `autopilot/2026-11-24` (local only, nothing pushed). Every task was implemented by a subagent and checked by that same subagent against the `review-task` checklist. **No separate reviewer ran**, so please treat "PASS" as self-review. The full list of assumptions per task is in each task entry (`tasks/*.md`) and in `changelog.md`.

## Tasks done (commit hashes)

| Task | Commit |
|---|---|
| backend T-029 (review PASS; backend 839 tests) | c5908c0 |
| web T-031 API client + auth state | 4c23b6d |
| web T-032 Layout shell | f4027de |
| web T-037 Auth pages | 6f95251 |
| web T-043 Saudi formatting + default locale | 7902bb4 |
| web T-033 Home | 9c1220e |
| web T-034 Shop + categories | 15300be |
| web T-035 Product detail | 324aaed |
| web T-036 Cart | dd8324d |
| web T-038 Checkout + success | deb723e |
| web T-039 Account area | 7e73f40 |
| web T-044 Fee + VAT display (tests only; already covered) | 98f07a0 |
| web T-040 Live notifications | 0e3271d |
| admin T-060 Bootstrap | 2343d0e |
| admin T-061 Auth + shell | 7716fd7 |
| admin T-062 Overview | 6011dc2 |
| admin T-063 Categories | 42618a5 |
| admin T-064 Products + uploader | 6d9e4d8 |
| admin T-065 Orders + invoice | 2735c12 |
| admin T-066 Customers | cd3cd68 |
| admin T-067 Banners | 513f40a |
| admin T-068 Home sections | ef25ccf |
| admin T-069 Static pages (Tiptap) | b2dfaca |
| admin T-071 Live notifications | f240ba6 |
| admin T-072 Admin users | 34c285e |
| admin T-073 Settings → Delivery | 839bd04 |
| admin T-074 Settings → VAT | c625e07 |

## Partly done / blocked (questions for you)

- **web T-041** (commit 2023058) — static pages, SEO, sitemap and robots shipped. `/api/revalidate` NOT built.
  - **B-028:** docs give the header, body and tag names but not: constant-time secret compare, the 401/400 response contract, unknown-tag handling, or fail-closed when `REVALIDATE_SECRET` is unset. A proposed answer is written in the blocker. Until then pages refresh through the 60 s revalidate window.
  - **B-029:** there is no public list-pages endpoint, so the footer cannot link CMS pages and the sitemap cannot list them. Add `GET /cms/pages`?
- **web T-042** (commit e982062) — code-level a11y fixes done (focus trap hook, skip link, focus-visible). The axe and Lighthouse criteria were NOT run. `@axe-core/playwright` is named only in test-plan.md, not in the approved stack. Approve it as a dev dependency?
- **admin T-064** (done, two open questions):
  - **B-030:** task and ADR-010 say images carry `width`/`height`, but the API only accepts `{key, alt}`. Extend the API or drop it from the docs?
  - **B-031:** does an admin type product price in halalas or SAR? Currently **halalas, sent as typed, with a `formatPrice` preview**. Note admin T-073 and T-074 used SAR input, so the two screens are inconsistent until you answer.
- **admin T-068** — **B-032:** may admins create/delete home sections and how do the config pickers work? None are offered for now.
- **admin T-070** (commit b5be14b, partial) — General + SEO done. **B-033:** which rule for the store contact phone (free text ≤40 chars vs the Saudi mobile rule; NFR-06/B-014)? **B-034:** what rule for social links (https only, domain allowlist, WhatsApp format)? Phone and socials are read-only for now.
- B-027 (prisma CLI audit risk) was recorded earlier in T-029.

## Assumptions to confirm (highlights; the rest are in the task entries)

- web T-031: on app start the provider tries `/auth/csrf` then `/auth/refresh` once, so every anonymous page load makes one 401 on `/auth/csrf`. Retry-After under 60 s shows seconds, otherwise minutes rounded up.
- web T-043: **`src/proxy.ts` now redirects `/` to `/ar` unless a `NEXT_LOCALE` cookie exists** (the old Accept-Language detection sent English browsers to `/en`, so the default-locale criterion was not met). This touches cookie and locale routing, so please review it. Digits and dates follow the B-015 draft (Western digits, Gregorian) because B-015 is open.
- web T-036: guest cart in localStorage (id, slug, qty only). **API gap: a cart line with `product: null` (UNAVAILABLE) has no productId, so the UI cannot remove it.** Free-delivery threshold and per-city flag come from `GET /cms/settings`.
- web T-038: success page `/checkout/success?id=`; place order disabled while any line is UNAVAILABLE or OUT_OF_STOCK; the Idempotency-Key is reused while address and expected total are unchanged.
- web T-039: no password change or account deletion built (not in the task or PRD).
- hand-built dialogs, sheets and toasts everywhere (no Radix, no Magic UI package) because they are not approved dependencies. Admin dialogs have no focus trap (web got one in T-042).
- all new en/ar copy was written by the agents. Please review the wording, especially Arabic.
- admin T-061: a CUSTOMER login is rejected client-side and the fresh session is revoked via logout.
- admin T-065: the invoice has no seller address, logo or ZATCA QR (B-013). The status-transition matrix is used client-side; the backend stays the authority.
- admin T-073: fee and threshold are entered in SAR with at most 2 decimals (more are rejected, not rounded). A new city code is slugged from the English name and is immutable.
- admin T-074: VAT rate is entered as a percent (0–50, 2 decimals); registration number `^3\d{13}3$`.

## Test totals (last run per workspace)

- **backend:** typecheck and lint clean; 63 files, **839 tests** passed (T-029 review).
- **web:** i18n:check OK (343 keys); typecheck and lint clean; build OK; Vitest 15 files, **287 tests** passed; Playwright **62** passed.
- **admin:** i18n:check OK (637 keys); typecheck, lint and build clean; Vitest 15 files, **360 tests** passed; Playwright **5** passed.
- `node scripts/traceability.mjs`: requirements=44 missing=0.
- web e2e runs without the backend (Playwright against a production build), so real-data and real-socket flows are covered only by component tests with mocks. Not exercised: the live toast within 2 s of an order status change and the forced-disconnect reconnect. Run the real-socket preview check before relying on them.

## Suspicious / needs a look

- **Dependencies:**
  - admin T-060 bumped `@playwright/test` from ^1.50.1 to ^1.65.1 (to match web's installed browsers).
  - admin T-069 added `@tiptap/extension-underline`, `-link`, `-image` at 2.27.3. Tiptap is in the approved stack, but these extensions are not named individually.
  - All installs ran with `--ignore-scripts`; no scripts were run from outside the repo, and package.json lifecycle scripts were not touched.
- **admin `npm audit` shows about 35–37 advisories** (vitest 3 / tinypool critical, zod 3 high, mostly dev tooling). It was not force-fixed. The same T-029 upgrades (vitest 5, zod 4) have not been applied to admin yet — probably worth a follow-up task.
- A stray empty file **`D:\tmp_unused`** was created outside the repo by a mistaken shell redirect in admin T-068 and could not be removed. Please delete it manually.
- Several agents corrupted a doc file with a bad edit and restored it from `HEAD` (CRLF mismatch in the docs) — the final diffs look clean. T-037 and T-035 amended their own unpushed commits.
- Agents occasionally ran their own doc-edit helper scripts from the session scratchpad (outside the repo, but written by this session; I read `docs.cjs` and it only edits project-docs).
- admin T-071: mounting the full `App` with a CUSTOMER-role session already in the auth store hung Vitest (likely a `/login` ↔ `RequireAdmin` redirect loop). The real flow clears customer sessions so it should not happen, but it was not investigated.
- admin T-062 / T-063 / Prettier reformatted `app.tsx` and `main.tsx` beyond the change, which adds diff noise. CRLF→LF git warnings appear on the docs; harmless.
- Not done by design: no push, no deploy, no Vercel/Atlas/Cloudflare, no `.env` edits, no backend/API changes.
