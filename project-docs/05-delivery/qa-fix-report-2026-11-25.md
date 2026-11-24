# QA fix report — 2026-11-25

Branch **`fix/qa-2026-11-24`**, 22 commits, one per item. **Nothing pushed, no deploy, no `demo:reset`
or any other data command, no seed. `.vscode/`, loader scripts and `package.json` lifecycle scripts
untouched.** Two dependency changes, both approved and evidenced in §7.

Scope: the two QA reports of 2026-11-24 (admin + storefront) as batches **A1–A6**, **B1–B8**,
**C1–C5**, the owner's review decisions on batch A, and **T-075a** (admin on zod 4).

---

## 1. Batch A — critical

### A1 · Register answered 500 but created the account — `07777ba`
**Root cause** (read from the code; no log lines were supplied): `register` created the user row and
the OTP row and *then* sent the mail. A transport failure escaped as `500 INTERNAL_ERROR` while the
OTP row had already started the 60 s cooldown — exactly the reported chain: the account existed (login
said `EMAIL_NOT_VERIFIED`) and the retry was answered `429`.

**Fix.** Issuing and sending are one step (`issueAndSendOtp`). On a send failure the row of the code
nobody received is deleted, the pending registration is kept, and the caller gets **503
`EMAIL_SEND_FAILED`** and may retry at once. Same for `resend-otp` and `forgot-password`. An
unverified login whose new code cannot be sent still answers `403 EMAIL_NOT_VERIFIED` — a 503 there
would be a password oracle. The code never reaches a log line; the transport error goes through the
redacting logger (NFR-04). Spec first.

**Fail-first:** 5 of the 6 new tests failed with 500; the sixth (no secret in the body) passed on the
500 body too and is stated as such.

### A2 · Product editor did not pre-select the category — `faa305f`
**Root cause.** The `<select>` is registered while `/admin/categories` is still in flight, so
react-hook-form applied the product's id to a select that had no matching `<option>` yet and the
element fell back to the placeholder. Because a select is read back from the DOM **on blur**, opening
and leaving the field really did clear it — the reported "This field is required".

**Fix.** The loaded values are re-applied once, as soon as the options exist, with `keepDirtyValues`.
**Side finding:** the submitted body always carried the right `categoryId`, so no product was ever
saved into a wrong category; the bug was the shown value and the blur that cleared it.

**Fail-first:** `expected '' to be 'c2'` in en and ar, on a product in a **child** category.

### A3 · Admin money inputs took halalas — `2148a0e` (closes B-031)
SAR 150 had to be typed as 15000. One rule now lives in `admin/src/lib/money.ts`: SAR with at most 2
decimals, converted to integer halalas by string/integer arithmetic (no float cents), group
separators, Arabic-Indic digits and the Arabic decimal mark accepted, negatives and 3 decimals
rejected and never rounded. Converted: product price and compare-at price. Already SAR and now sharing
the module: base delivery fee, free-delivery threshold, per-city fee override. The API keeps taking
halalas; a saved amount reads back in SAR in the list and the form.

**There is no COD-limit field in the API or the admin**, and every other money place in the admin
(orders, invoice, overview, dashboard) only displays what the API returns, so nothing else needed
converting.

**Fail-first:** 20 assertions in en and ar — "150" was sent as 150 halalas, "150.5" was rejected
outright, the editor showed 129900 instead of 1299.

### A4 · The admins page offered Block where the API refuses it — `431c1b9`
Block was rendered on every row, the signed-in admin's own included. It is now disabled with the
reason beside it (`aria-describedby`), on your own row and on the last active verified admin; a
pending invite does not count as active and Unblock is always offered. No new copy — the approved
`errors.SELF_BLOCK` / `errors.LAST_ADMIN` are reused.

**The backend already enforced the whole rule and nothing in it was changed:** self-block is 422
`SELF_BLOCK`, the last active verified admin is 409 `LAST_ADMIN` (serialized with a counter doc against
concurrent blocks), the customer routes refuse the caller's own id with 403 `FORBIDDEN_TARGET`, and
**no route demotes or deletes an admin at all**. A new backend test states that in one place; it passed
on the first run, so there was no failure to reproduce on that side.

**Fail-first (UI):** three tests, `expected false to be true` — the button was enabled.

### A5 · Logout left the session readable; Back showed cached data — `de44fd3`
Admin: logout cleared the token and the user, but react-query kept every answer of the session. The
cache is now emptied wherever a session ends — one subscriber covers the logout button, a customer
cookie and a failed refresh alike. Storefront: the cart, favourites and notification stores already
reset and the app uses no react-query hooks, so what was left was the **Next router cache**;
`SessionReset` refreshes it when the session ends and the account shell then sends the guest to
`/login`. Both apps also re-check with the server when the browser restores a document from the
**back/forward cache** (`pageshow` + `persisted`) — the one case where Back can genuinely paint a page
from a session that is over.

**Fail-first:** 4 admin tests; on the web the 4 behavioural assertions were re-run with the two
effects disabled and failed, then passed restored.

### A6 · Invoice: owner's VAT rule, seller from settings, ZATCA Phase 1 QR — `18db7ce`
The seller is the store name from **settings** (it printed the admin app's own name). The VAT
registration number on the order snapshot decides the document: none → "Invoice" / «فاتورة», no VAT
line, no QR; set → "Simplified tax invoice" / «فاتورة ضريبية مبسطة» with seller name, VAT number,
issue date and time, line totals, VAT amount, total including VAT and the QR. A snapshot rate above 0
always shows the VAT line, so a charged VAT can never be hidden. Settings must load before the sheet
renders, so an invoice never prints without a seller.

TLV (`admin/src/lib/zatca.ts`): five fields, UTF-8 **byte** lengths (an Arabic seller name is 2
bytes/letter), integer-only amounts, second-precision UTC timestamp, 255-byte clamp on a character
boundary. Tested against the specification's worked example byte for byte, with the expected bytes
written out as hex so the tag/length/value structure is checkable without trusting the base64.

**Already in place, verified not re-added:** the optional VAT registration number setting (15 digits,
starts and ends with 3, api-spec `^3[0-9]{13}3$`, 422 test, VAT tab, snapshotted per order).

**New launch blocker B-041: ZATCA Phase 2** (invoice UUID, cryptographic stamp/CSID, hash chain, UBL,
clearance) — for the owner and their accountant. **B-013 is resolved for Phase 1.**

## 2. Batch A review decisions (owner) — `9ed9939`, `bf4d353`

1. **VAT may only be charged by a registered seller** (replaces my A6 judgement call).
   `PUT /admin/settings` answers **422 `VAT_NUMBER_REQUIRED`** when `vat.vatRate > 0` and no
   registration number is set, checked before the transaction so a rejected save writes nothing. Spec
   first. The VAT tab refuses it before sending with the owner's sentence under the number field, and
   shows the same text if the API answers the code. Existing snapshots untouched — an order that
   charged VAT still shows its VAT line, so history is never hidden. Fail-first on both sides; three
   existing VAT-tab tests now set a number (their subjects — untouched fields, `STALE_UPDATE`,
   `VALIDATION_ERROR` — are unchanged).
2. **TLV money fields confirmed**, and now *decoded* rather than compared as base64: the tests gained
   a real TLV walker, so all five fields read back. Tags 4 and 5 are SAR strings with two decimals
   built from integer halalas by string arithmetic — 115000 → `"1150.00"`, 15000 → `"150.00"`, with 0,
   1, 70, 999, 100000 and 24940000 halalas each cross-checked against the halalas they came from. No
   float touches them.
3. **Arabic `products.form.moneyHint`** replaced with the owner's wording.

## 3. Batch B

| Item | Commit | What was wrong, and what it is now |
| --- | --- | --- |
| **B1** cart | `a21e807` | Two causes: the cart response carried no `productId` for a line whose product was gone, and `PUT /cart/items` answered 404 for a deleted product **even with `qty: 0`**, so the line was unremovable. Spec first: `productId` on every line; a `qty: 0` remove always succeeds, idempotently. The line now has a remove button (no undo offer — putting it back would fail), stays out of the item count and totals, and blocks checkout there with the checkout page's approved wording. The guest cart and guest favourites drop a 404 product from localStorage and their badges by themselves (owner-confirmed reading); the server wishlist already returned PUBLISHED only. Closes **B-035**. No new copy. Fail-first: 3 backend + 6 web assertions. |
| **B2** auth pages | `bf18163` | A signed-in visitor stayed on /login (and /register had no redirect at all) and then landed on the home page. They now continue to `?next=` when it is a path on this site — `safeNext` rejects absolute URLs, `//host`, schemes, backslashes and control characters, and strips a locale prefix — or to the account page. The CSRF token is no longer fetched before the refresh: only a request carrying a session cookie can be answered 403 `CSRF_INVALID`, so a guest's page load no longer makes a `GET /auth/csrf` that is answered 401 by design. **Owner decision: no session-marker cookie for now**, so a cold load for a signed-in customer costs one extra round trip (refresh → csrf → refresh). Verified on a production build. Fail-first: 10 of 14. |
| **B3** single-flight | `3aaf210` | The refresh already was single-flight; what was missing was around it. `fetchCsrf` is single-flight too; a refresh overtaken by a sign-out (or another sign-in) drops its result and stops spending requests — an auth-store epoch. **That race is also the admin test flake reported with batch A**: a refresh left in flight by one test wrote into the next, which is exactly its two symptoms. The guest cart dedupes in-flight product resolves (the drawer and the page fetched each product twice). Checkout: one refresh and at most one CSRF for a whole load, asserted. Verified on production builds. Fail-first: 5 of 9 (the two csrf single-flight assertions cannot fail while the refresh around them is already single-flight, and are stated as belt-and-braces). |
| **B4** admin i18n | `43de4c6` | `{{n}}` never interpolated: this app configures i18next with single braces and that one string used i18next's default. `SHOP_THE_LOOK` printed a raw key because the admin's list was the list of types an admin may *create* — now two lists, and the label reuses the storefront's approved wording. The new test fails on the whole class: wrong placeholder syntax, placeholder parity (Arabic duals exempted, invented variables not), every literal `t("…")` key, every union member, and no `{{…}}`, `{placeholder}` or bare dotted key in rendered pages. Fail-first: 7 of 16. Two findings left alone because both are correct: the Arabic dual plurals legitimately omit the numeral, and `orders.payment` has only COD/UNPAID/PAID. |
| **B5** order 404 | `f39e203` | A 4xx is the server's answer, not a hiccup: the admin query client no longer retries 4xx (5xx and network errors keep their one retry), and the order page has its own state — "This order no longer exists." with the Back link and no Retry. The tests mount the App **without** a QueryClient so they run against the app's own policy. Fail-first: 4 of 4. |
| **B6** categories | `2157b33` | The API returns categories by `sortOrder`, so a child with a lower sortOrder than its parent was listed above it, in the table and in the product dropdown. `sortAsTree` keeps the API's order among parents and puts each parent's children straight after. The ADM-03 stub now answers like the API — without that the old fixture happened to be parent-first and hid the bug, and its assertions were substring-ambiguous ("sofas" matches "corner-sofas"). Fail-first: 3. |
| **B7** SEO | `0b8ad6f` | Duplicate brand gone ("About us \| Furnixa \| Furnixa"); every page has a description (the layout falls back to the catalogue sentence when the admin SEO description is empty or the API is unreachable, and the shop listing builds its own from the category it filters by, taking that category's name as its title); Open Graph defaults plus a generated brand share image from the `globals.css` tokens — no photograph, so nothing depends on the placeholder photos whose licensing is open (B-038) — and a product uses its own main photo. **The 404 title race is fixed and its cause proven, not guessed** (see §5). Two Next behaviours measured and documented at the call sites: `description: undefined` **clears** inheritance, and a page-level `openGraph` **replaces** the layout's whole object. |
| **B8** audit triage | `e3f9732` | See §6. |

## 4. Batch C

| Item | Commit | What was wrong, and what it is now |
| --- | --- | --- |
| **C1** sign-in flash | `91be097` | An unknown admin URL showed the sign-in form before "Page not found". The guard decided on `status` alone — which can already be "anonymous" from an earlier attempt while the current restore is in flight — and the first paint happens before the restore effect even starts. The store now carries `restoring` (true from its initial state, because the app always attempts a restore on mount) and the guard waits while auth is being resolved. A session that is already known keeps its page, so re-checking it after a back/forward restore cannot flicker to the loader; without that condition the shell unmounted and remounted on every mount, which the notifications tests caught as a second socket connection. Fail-first: 6 of 6. |
| **C2** empty email | `db60e9a` | The fields only had the email-shape check, and an empty string fails that too. All three admin email fields — sign in, accept invite, invite an admin — now require the value first and keep the shape message for text that is really not an address. No new copy. Fail-first: 6 of 6; the existing ADM-11 invite test now expects three "required" errors instead of two. |
| **C3** Arabic sidebar title | `bcc10fa` | «لوحة تحكم فورنيكسا» wrapped in the 240 px sidebar header at `text-lg`. It now sits at `text-base`, may not wrap, is clipped with an ellipsis if it ever would be, and keeps the full name as a tooltip. **Measured in the browser** on the production build (jsdom has no layout): a new admin e2e checks that the name occupies exactly one line box, is no taller than one line and is not quietly clipped, in ar and en. |
| **C4** code splitting | `5264b29` | See the numbers below. |
| **C5** account menu | `abbb67e` | **Plan only, no code**: `05-delivery/admin-account-menu-plan.md`, with task entries **backend T-108** and **admin T-109**. Two findings: **Profile needs no API work** (`PATCH /me` is behind `requireAuth` with no role check, so an admin may already update their own name), and **Change password needs one new endpoint** because the only existing path is the OTP forgot/reset flow, which never asks for the current password and revokes every session. The plan's sharpest detail: setting `passwordChangedAt` invalidates the caller's own access token, so the endpoint must answer with a fresh token and refresh cookie or the admin would sign themselves out. Eleven new en/ar strings are listed for approval, plus one open question (should other admins be notified). |

### C4 bundle sizes, measured on the production build

```
before   index.js            1,605.59 kB   gzip 476.85 kB   (one chunk)
after    index.js (entry)      607.60 kB   gzip 186.77 kB   -62% / -61%
         overview-page         411.84 kB   gzip 112.72 kB   (Recharts)
         pages-page            352.19 kB   gzip 112.14 kB   (Tiptap)
         sortable.esm           46.41 kB   gzip  15.52 kB
         invoice-page           28.46 kB   gzip  10.22 kB   (QR encoder)
         settings-page          18.29 kB   gzip   5.83 kB
         banner-editor-page     14.74 kB   gzip   5.03 kB
         + 20 more, each under 11 kB
```

The sign-in page and the shell stay in the entry chunk (what a cold visit renders) and the Suspense
boundary sits inside the shell, so the sidebar and top bar never blink. The entry chunk still trips
Vite's 500 kB warning — React, the router, react-query, i18next, zod with react-hook-form, the shell
and the sign-in page — and splitting vendors further was left out of scope. After T-075a the entry is
**638.60 kB (gzip 199.25 kB)**: zod 4's runtime is about 31 kB larger.

Six existing tests now await the page they open (the two invite screens, lazy now); no assertion
changed. One real ordering finding from that: the accept-invite page sends a signed-in visitor to the
dashboard, so the B4 test had to stop handing it a session.

## 5. Two framework behaviours measured, not assumed

**The 404 title.** Next drops the metadata of a segment that calls `notFound()`, and `not-found.tsx`
cannot export metadata, so the title fell back to the layout's `title.default` — the bare brand. Three
probes: a hard-coded title in the catch-all's `generateMetadata` never reached the head; a `<title>`
rendered inside the 404 component was stripped; only `title.default` was ever emitted. So the layout's
default title **is** the not-found title, which is the only render that ever uses it, because every
real page sets its own — the home page absolutely, since its proper title is the store name alone.
`qa-titles.spec.ts` now passes 6/6 repeats where it failed 2 of 6. The 404's description stays the site
default (the layout cannot vary it per render) and the 404 status is what crawlers act on.

**Metadata merging.** An explicit `description: undefined` *clears* the inherited description, and a
page-level `openGraph` *replaces* the layout's whole object (site name and image included). Both are
now worked around and commented where it matters.

## 6. Security audit (B8 + T-075a)

`npm audit` in `admin/` before: **39** (36 moderate, 1 high, 2 critical). `--omit=dev`: **29** (28
moderate, 1 high) — so **both criticals are dev-only** (`vitest`/`@vitest/mocker`/`tinypool`: a
prototype-pollution gadget to RCE in the test runner's worker options, never shipped).

All production entries came from three causes, each fixable only by a major upgrade:

| Cause | Severity | Fix | Exposure | Decision |
| --- | --- | --- | --- | --- |
| `zod` < 4.6.6 | **high** | zod 4 | Admin-only: validates admin form input in the browser; backend and web were already on zod 4 | **Done now (T-075a)** |
| `@tiptap/core` ≤ 3.30.3 (27 entries) | moderate | tiptap 3.35 (from 2.x) | CMS editor only, authenticated admin, own content, sanitised server-side on every write (ADR-013) | **Post-launch**, recorded in T-075 |
| `i18next` < 26.3.4 | moderate | i18next 27 (from 24.x) | Not reachable: only the two static locale files are ever merged | **Post-launch**, recorded in T-075 |
| `vitest`/`tinypool` (2 critical) | critical | vitest 5 | Dev only | Stays in T-075 |
| `typescript-eslint` + `minimatch` | moderate | non-major | Lint tooling only | Left alone deliberately (production first) |

After T-075a: production **28 (0 high)**, total **38**. Checked while there: **web has 0 production
advisories**, and the backend's 4 highs are all the **prisma CLI** (`@prisma/config` → `deepmerge-ts`
stack exhaustion, `effect` ReDoS) whose offered fix is `prisma@7` — **forbidden by ADR-001** — while
`@prisma/client`, the only Prisma code in the request path, is not flagged and the CLI runs at
build/migrate time.

## 7. Dependency changes (two, both approved)

**`qrcode-generator@2.0.4`** (A6, approved with conditions). Chosen over `qrcode` (3 direct, ~15
transitive dependencies, no bundled types), `qrcode-svg` (last published 2022) and `qrcode.react` (a
renderer with no module matrix): zero dependencies, bundled TypeScript types, no install scripts, 9.5M
weekly downloads, published 2025-08-07, MIT, by the author of the canonical implementation. Pinned
exactly, installed with `--ignore-scripts`. The lockfile gained exactly one entry, resolved from
registry.npmjs.org with the registry's own integrity hash; prod packages 154 → 155; `npm audit`
unchanged at 39 advisories, none of them this package. Only the module matrix comes from the library —
the QR is our own inline SVG, so the payload stays in the browser.

**`@hookform/resolvers` 4.1.3 → 5.9.2** (T-075a, **not separately approved — flagged here**). It had
to come with zod 4: v4 only speaks zod 3, and with zod 4 installed `zodResolver` returned no messages
at all — twelve form-validation tests across ADM-03, ADM-07 and ADM-08 failed with their error text
missing. 5.9.2 is the smallest version that declares `zod: ^3.25.0 || ^4.0.0` (with
`react-hook-form: ^7.55.0`; installed 7.91.0). It is an upgrade of a package already in use, installed
with `--ignore-scripts`. The lockfile has exactly two version changes (`zod`, `@hookform/resolvers`)
and no package name added or removed — `ajv` and `json-schema-traverse` only moved from the root to
nested under `eslint`, because the old resolver had pinned the hoisted copy; no added package has an
install script; every `resolved` URL is on registry.npmjs.org.

## 8. Copy

**Approved by the owner and confirmed byte for byte in the files** (codepoint-compared, not eyeballed):
`shop.metaDescriptionAll` = «تصفّح الأثاث الجديد والمستعمل في {brand}.», `shop.metaDescription` =
«تصفّح {category} في {brand}.», `orders.notFound` = «هذا الطلب لم يعد موجودًا.»,
`sections.type.SHOP_THE_LOOK` = «تسوّق هذا التنسيق», plus their English counterparts, the A3 money
strings, the A6 invoice strings and the VAT-number sentence.

**Waiting for approval:** the eleven strings in §4 of `admin-account-menu-plan.md` (C5). Nothing is
built against them.

## 9. Open items and decisions for the owner

1. **B-041 ZATCA Phase 2** — launch blocker, needs the owner and their accountant.
2. **C5** — approve the account-menu plan and its copy, and answer the one open question (notify other
   admins when an admin changes their own password?).
3. **T-075** — vitest 5 (the two dev criticals), tiptap 3 and i18next 27 are queued post-launch.
4. **B2** — no session-marker cookie, as decided; the cold-load refresh for a signed-in customer keeps
   its extra round trip.
5. Still open from before this batch: **B-034** social links (the admin Social tab stays read-only),
   **B-036** / **B-037** owner wording questions, **B-038** photography, **B-040** legal texts, the
   remainder of T-045, CR-010 T-086/T-087/T-088, and follow-ups T-085/T-089.

## 10. Checks (final run, all three apps)

| | Unit | e2e | Other |
| --- | --- | --- | --- |
| backend | **989** / 71 files | — | typecheck, eslint, prettier |
| admin | **552** / 27 files | **9** | typecheck, eslint, i18n 686 keys, production build |
| web | **706** / 47 files | **122** | typecheck, eslint, i18n 409 keys, production build |

`node scripts/traceability.mjs` → `requirements=50 missing=0`. Working tree clean.

The admin flake reported with batch A (AUTH-02 `REFRESH_RACE` / `valid admin credentials`) has not
reappeared since B3; its mechanism is gone, not merely quiet. The web e2e `qa-titles` 404 failure
reported with batch A is fixed in B7 and verified over repeats.

## 11. Commits

```
07777ba A1 register never 500s (503 EMAIL_SEND_FAILED)
faa305f A2 product editor pre-selects the category
2148a0e A3 admin money inputs take SAR (closes B-031)
431c1b9 A4 Block disabled where the API refuses it
de44fd3 A5 signing out leaves nothing behind
18db7ce A6 invoice: VAT rule, seller from settings, ZATCA Phase 1 QR
9ed9939 owner review 1: VAT rate needs a registration number
bf4d353 owner review 2 and 3: TLV money fields confirmed, Arabic money hint
a21e807 B1 unavailable cart lines (closes B-035)
bf18163 B2 auth pages continue; no CSRF without a session
3aaf210 B3 one refresh, one CSRF fetch, one fetch per product
43de4c6 B4 admin i18n strings and a test for the class
f39e203 B5 unknown order id says so, no 4xx retry
2157b33 B6 child categories under their parent
0b8ad6f B7 SEO titles, descriptions, Open Graph, 404 title
e3f9732 B8 admin npm audit triage
91be097 C1 wait for auth instead of flashing the sign-in form
db60e9a C2 empty email says required
bcc10fa C3 Arabic dashboard name on one line
5264b29 C4 route-based code splitting
abbb67e C5 account menu plan (plan only)
1efeb6f T-075a admin on zod 4
```
