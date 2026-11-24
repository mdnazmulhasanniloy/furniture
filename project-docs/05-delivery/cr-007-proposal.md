# CR-007 proposal — UI redesign "Emerald and gold" + motion + favourites

Source: `SRC-008` (`01-discovery/client-notes-2026-11-24.md`). Draft ADR: `ADR-014`.
Status: **CONFIRMED by the owner 2026-11-24 and applied** (docs). Owner answers: all proposed values accepted; gold progress fill = `--gold-strong` #9C7A2E (≥ 3:1 on white and muted, `--gold` decorative only); `--accent` call sites map to primary or gold by meaning; wishlist is per item (`PUT/DELETE /me/wishlist/{productId}`, idempotent); contact strip only (newsletter = future CR); fixed hero + How resale works + contact strip, other sections admin-ordered; text wordmark Furnixa / فرنيكسا with a thin gold underline; sonner approved; enter-only page transitions; LCP < 2.5 s with a priority first hero image; task IDs as proposed. Note: with `PUT/DELETE` per item, the proposed `DELETE /me/wishlist` (clear all) is kept as an additive endpoint. After confirmation: apply these edits, create the tasks (§5), run `node scripts/traceability.mjs`, add the changelog entry. No code is written by this change request.

## 1. Summary of impact

| Area | Change | Size |
|---|---|---|
| Design system | Palette §1 rewritten, badges/product card §4, motion §5, dark values | M (docs) |
| PRD | `wishlist` leaves non-goals; new **FAV-01**; UI-01, UI-02, PROD-01, CART-01, AUTH-01..04 (visual), CAT/ADM-07 home amended | M |
| Screen specs | W-01 Home, W-02 card, W-04 Cart, W-06 Auth amended; new **W-08 Favourites** | M |
| API spec | `/me/wishlist` (+ `/{productId}`, `/merge`), `WishlistState`, 3 error codes | M |
| Data model | New `Wishlist` | S |
| Backend | 1 task (FAV-01) | M |
| Web | 7 tasks (see §5) | L |
| Admin | 1 task (palette + dark + AA gate) | S |
| Risk | Token values alone are **not enough** (see §3); LCP budget vs. heavier home | — |

## 2. Proposed edits per document

### 2.1 `03-design/design-system.md`
- Title/mood: "Emerald and gold" — calm, bright, showroom; white canvas, deep emerald, brass accents.
- §1 token table (light), replacing every row:

| Token | Hex | Use |
|---|---|---|
| `--background` / `--card` | `#FFFFFF` | Page / cards |
| `--foreground` | `#1C2321` | Body text |
| `--muted` / `--muted-foreground` | `#F4F6F5` / `#5F6B66` | Bands, inputs / secondary text |
| `--primary` / `--primary-foreground` | `#0F4C45` / `#FFFFFF` | Buttons, links, "New" badge |
| `--secondary` / `--secondary-foreground` | `#F6EFD9` / `#6B5318` | "Pre-owned" badge, soft CTA |
| `--gold` / `--gold-foreground` **(new fg)** | `#C8A24A` / `#1C2321` | Decoration, icons, CTA fill, "Featured" badge |
| `--price` **(new)** | `#86672A` | Amounts only (`Price` component) |
| `--border` / `--ring` | `#E6E9E7` / `#0F4C45` | Dividers / focus ring |
| `--input` **(new, proposed)** | `#7D8A85` | Form-field borders (3:1 needed, `--border` is 1.2:1) |
| `--destructive` / `--success` / `--warning` | `#B42318` / `#1F7A4D` / `#B7791F` | Fills, icons, tinted badge backgrounds |
| `--warning-foreground` **(new, proposed)** | `#7A4B05` | Text on warning tint (badge text "darkest shade") |
| `--success-foreground` **(new, proposed)** | `#17603B` | Text on success tint |

- Remove `--accent`. Dark (admin): the owner's eight values plus proposed `--secondary` `#2A2616` / fg `#E9DDB8`, `--destructive` `#F28B82`, `--success` `#5CC38F`, `--warning` `#E3A93E`, `--ring` `#4FB3A3`, `--input` `#6B7A75`, `--gold-foreground` `#1C2321`, `--price` `#D9B865`.
- §1 contrast paragraph replaced by the table in §3 of this proposal.
- §2 typography unchanged (Fraunces / Noto Kufi Arabic headings already there). Add: generous whitespace scale (section gap ≥ 64 px desktop / 40 px mobile).
- §4 badges: `New` primary filled/white · `Pre-owned · {grade}` secondary/secondary-foreground · `Featured` gold/gold-foreground · `Sold out` muted. Product card per SRC-008.7 (heart toggle, price colour, quick add / disabled "Sold out"). Placeholder spec (emerald pattern + brand mark; B-022 / B-006).
- §5 motion table per ADR-014 (cart drawer + add-to-cart fly + toast added to Framer row; hero zoom, section reveals added to GSAP row; AOS limited to content pages). Reduced motion + RTL mirroring rule kept; "page transitions are enter-only" added.

### 2.2 `02-product/PRD.md`
- §3 Non-goals: delete `wishlist`.
- New requirement:
  **FAV-01 Favourites** · draft (SRC-008.8–10) — Customers save products as favourites with a heart toggle on cards and the product page.
  - Given I am a guest, When I tap a heart, Then the product is stored in this browser only (localStorage, product ids, max 100) and the header heart count updates.
  - Given I log in, When login completes, Then the guest list is merged into my account list (union, existing first, cap 100, unpublished/unknown products skipped) and the local list is cleared **only after** the merge succeeded; on failure it stays and a retry is offered.
  - Given I am logged in, When I toggle a heart, Then the account list changes (idempotent per product) and survives devices.
  - Given a favourited product is unpublished or deleted, Then it is not shown and not counted.
  - Given my list has 100 items, When I add another, Then I see a localized "favourites full" message.
  - The favourites page lists my favourites (card grid, remove, empty state); admins have no account favourites (the heart works as a guest list only).
- UI-01: palette and motion references updated (GSAP home, Framer components/pages, AOS content). UI-02: add "automated AA check on tokens (ADR-014)".
- PROD-01: card spec (4:5, crossfade, badge, heart, 2-line title, price, quick add / "Sold out"). CART-01: remove with undo (re-adds the line), gold free-delivery bar, VAT line only when > 0, sticky checkout on mobile.
- AUTH-01..04: split layout, inline validation, animated OTP — behaviour unchanged (visual only).
- ADM-07 / home: fixed parts (hero from banners, "How resale works", contact strip) plus the existing admin-ordered sections (see Q-6, Q-7).
- Traceability: add FAV-01; release criteria §7 add "AA token test green".

### 2.3 `03-design/screen-specs.md`
W-01 Home, W-02 Shop (card), W-04 Cart, W-06 Auth rewritten per SRC-008; new **W-08 Favourites** (header heart + count, grid, empty state, merge-failed notice); W-07 Account gets a "Favourites" link.

### 2.4 `04-architecture/api-spec.yaml` (customers only, bearer auth, CSRF as other `/me` writes)

| Method | Path | Behaviour |
|---|---|---|
| GET | `/me/wishlist` | `WishlistState` + `items: ProductSummary[]` (published only, newest first) |
| PUT | `/me/wishlist` | body `{productId}`: add (idempotent) → 200 `WishlistState`; unpublished/unknown → 404 `PRODUCT_NOT_FOUND`; full → 409 `WISHLIST_LIMIT_REACHED` |
| DELETE | `/me/wishlist/{productId}` | remove one (idempotent) → 200 `WishlistState` |
| DELETE | `/me/wishlist` | clear all → 204 |
| POST | `/me/wishlist/merge` | body `{productIds: string[≤100]}` → union (existing first, then given order), skip unknown/unpublished/malformed, truncate at 100 → 200 `{productIds, skipped, truncated}`; idempotent |

`WishlistState = {productIds: string[], total: integer}`. ADMIN → 403 `FORBIDDEN`. Rate limit: same as `/cart` writes. See Q-4 for the PUT/DELETE shape the owner wrote (`PUT/DELETE /me/wishlist` literally).

### 2.5 `04-architecture/data-model.md`
New row: **Wishlist** — `userId` (unique), `productIds` ObjectId[] (max 100), `version` Int (default 0), `updatedAt`. One per user, created lazily. Writes use the same conditional-update-on-`version` pattern as Cart (retry up to 3, then 409 `WISHLIST_CONFLICT`). No foreign-key cleanup: ids of deleted/unpublished products are filtered at read and pruned on the next write. Index: unique on `userId`. Prisma/MongoDB note: scalar list of `@db.ObjectId`.

### 2.6 `04-architecture/adr/ADR-014-ui-redesign-tokens-contrast-motion.md`
Drafted (status Proposed). Accept after confirmation.

## 3. Contrast check of the owner's palette (computed, WCAG relative luminance)

| Pair | Ratio | Result |
|---|---|---|
| foreground on background / muted | 16.0 / 14.8 | pass |
| muted-foreground on background / muted | 5.55 / 5.12 | pass |
| price `#86672A` on background / muted / secondary | 5.27 / 4.85 / 4.58 | pass (secondary is tight) |
| primary button (white on `#0F4C45`) | 9.81 | pass |
| gold button (`#1C2321` on `#C8A24A`) | 6.65 | pass |
| "Pre-owned" badge (`#6B5318` on `#F6EFD9`) | 6.35 | pass |
| destructive button / text on white | 6.57 | pass |
| success text or white-on-success | 5.32 | pass |
| **warning text or white-on-warning** | **3.64** | **FAIL** → needs `--warning-foreground` `#7A4B05` (7.4 on white, 6.7 on its tint) |
| Dark: foreground, muted-foreground, primary button, gold, price on card | 8.2–16.4 | pass |
| **Dark: destructive `#B42318` as text on card** | **2.54** | **FAIL** → dark `#F28B82` (7.0) |
| **Dark: success `#1F7A4D` as text on card** | **3.14** | **FAIL** → dark `#5CC38F` (7.7) |
| Dark: warning `#B7791F` on card | 4.59 | pass but tight → proposed `#E3A93E` (8.0) |
| **Gold progress fill vs white / vs muted track** | **2.41 / 2.22** | **FAIL as a graphic (3:1)** → add 1 px `--input` outline to the track (3.59), the text label carries the meaning |
| **`--border` `#E6E9E7` as form-field border** | **1.22** | decorative borders are fine; **form fields need 3:1** → `--input` `#7D8A85` (3.59) |
| Gold accent line on emerald panel | 4.08 | pass (decorative) |

Consequence: "only token values" cannot hold. The new tokens in §2.1 and about 21 call-site class changes (`text-warning`, `text-success`, `bg-accent`, admin status badges) are required; ADR-014 records this.

## 4. Test plan for the AA gate (SRC-008.5)

One test in `web` and one in `admin` parse the `:root` (and admin `.dark`) blocks of the real CSS file and assert ≥ 4.5:1 for: foreground/muted-foreground on background, card and muted; `--price` on the same three surfaces; every Button variant (default, secondary, gold, destructive, outline, ghost, link) text on its fill; every badge variant text on its fill (New, Pre-owned, Featured, Sold out, order-status badges); and ≥ 3:1 for ring, `--input`, and the progress-bar fill/outline. Light for both apps, dark for admin. Names `UI-02 · AA contrast ...`.

## 5. Proposed tasks (IDs provisional; next free are web T-046, admin T-077, backend T-031)

| ID | Task | Depends | Req |
|---|---|---|---|
| backend T-031 | Wishlist model + `/me/wishlist` endpoints + merge; spec first; tests `FAV-01 · ...` (cap, idempotency, merge, unpublished skipped, customers only, concurrency) | T-010, T-012 | FAV-01 |
| web T-046 | Foundation: tokens (values + new tokens), `Price`/badge/button components on tokens, shared reduced-motion + RTL motion hook, AA test, placeholder component (emerald pattern + brand mark) | — | UI-01, UI-02 |
| admin T-077 | Admin palette + dark values + new tokens, status badge classes, AA test | web T-046 values | UI-01, UI-02 |
| web T-047 | Product card (crossfade, badge, heart UI, 2-line title, quick add / Sold out) | T-046 | PROD-01 |
| web T-048 | Favourites: guest store, merge after login, page, header count | T-047, backend T-031 | FAV-01 |
| web T-049 | Login/Register split layout, inline validation, animated OTP + countdown | T-046 | AUTH-01..04 |
| web T-050 | Home redesign: GSAP hero + reveals, bento grid, rows, How resale, marquee, contact strip, placeholders; AOS content pages + Framer page enter transition | T-046, T-047 | CAT-01, ADM-06/07, UI-01 |
| web T-051 | Cart drawer + page redesign, undo toast, add-to-cart fly + toast, gold bar, sticky mobile checkout | T-046, T-047 | CART-01 |

Order: T-046 → (T-047, T-049, admin T-077, backend T-031 in parallel) → T-048, T-050, T-051. Each task follows the normal loop (plan → tests in en and ar → checks including build and e2e → `/review-task` → one commit on the branch). Existing T-042 (motion and accessibility pass, partly done) is re-checked at the end because the tokens and motion change under it.

## 6. Open questions (answers needed before applying)

| # | Question | Proposed answer |
|---|---|---|
| Q-1 | Warning "darkest shade" value and dark values for secondary / destructive / success / warning / ring (§2.1). | Use the values in §2.1 (all computed AA-pass). |
| Q-2 | `--accent` is not in the new palette but is used in 6 files (cart badge, unread dot, address form, account menu, fly animation, globals). | Remove it; amounts use `--price`, decorations use `--gold`. |
| Q-3 | Add `--input` for form-field borders (needs 3:1; `--border` is 1.2:1). | Add `--input` `#7D8A85` light / `#6B7A75` dark. |
| Q-4 | Wishlist shape: the brief says `GET/PUT/DELETE /me/wishlist`. Literal reading = PUT replaces the whole list, DELETE clears it. That loses updates when two tabs or devices toggle hearts. | Item-level: `PUT /me/wishlist {productId}` adds one, `DELETE /me/wishlist/{productId}` removes one, `DELETE /me/wishlist` clears (§2.4). |
| Q-5 | Merge order when over the cap: which 100 survive? | Existing account items first, then guest items in saved order; extras dropped and reported (`truncated`). |
| Q-6 | "Newsletter or contact strip": a newsletter means collecting emails (new endpoint, storage, consent/PDPL wording, spam control), none of which is in the PRD. | Build the **contact strip** only (email, phone, WhatsApp from Site Settings, no new backend); newsletter deferred as a separate CR. |
| Q-7 | Home layout vs ADM-07: sections are admin-ordered today. | Hero (banners), "How resale works" and the contact strip are fixed; featured, new arrivals, Pre-owned picks, category grid, promo and testimonials stay admin-ordered and hideable. |
| Q-8 | Toast for add-to-cart and remove-undo: the repo has a hand-built notification toaster; design-system names shadcn Toast (sonner), which is not installed. | Reuse and extend the hand-built toaster (no new dependency); if sonner is wanted, it needs dependency approval. |
| Q-9 | Placeholder uses "the brand mark" but B-006 (brand/logo) is still open. | Use the working name "Furnixa" as a text/monogram mark until the logo exists; the logo from Site Settings replaces it when set. |
| Q-10 | Page transitions with Framer in the App Router can only animate **entering** pages (no exit animation). | Accept enter-only transitions. |
| Q-11 | Heart for admins on the storefront. | Admins get the guest (localStorage) list only, never merged; same as the cart. |
| Q-12 | LCP budget (G4, < 2.5 s): hero carousel with zoom + GSAP is heavy. | Hero first image is the priority LCP image; GSAP/ScrollTrigger lazy-imported; zoom starts after load; Lighthouse ≥ 90 re-checked in the final pass. |

## 7. Next step

Team + client: confirm §2 (edits), §5 (tasks) and answer §6. Then this CR proceeds to: apply the doc edits, create the tasks, `node scripts/traceability.mjs`, changelog entry `CR-007`. **Stopped here.**
