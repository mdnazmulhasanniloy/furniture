# Client Notes — 2026-11-24

Source: owner decision "UI redesign" (change request CR-007), given on branch `autopilot/2026-11-24`. Ref ID: `SRC-008`.
Status: **recorded, not yet confirmed by team + client.** Nothing here is applied to the PRD, design system, API spec or data model until the proposal in `05-delivery/cr-007-proposal.md` is confirmed.

## Original (verbatim, as pasted by the owner)

> 1. PALETTE "Emerald and gold" on a white theme. Update design-system.md first, then only the token values in web/src/app/globals.css and admin/src/index.css:
> Light: background #FFFFFF, foreground #1C2321, card #FFFFFF; muted #F4F6F5, muted-foreground #5F6B66; primary #0F4C45 / primary-foreground #FFFFFF; secondary #F6EFD9 / secondary-foreground #6B5318; gold (decorative, icons, CTA backgrounds) #C8A24A, with text on gold #1C2321; price text #86672A; border #E6E9E7, ring #0F4C45; destructive #B42318, success #1F7A4D, warning #B7791F (icons and badge backgrounds only; badge text in its darkest shade).
> Dark (admin): background #0E1513, card #15201D, foreground #EEF2F0; muted #1A2522, muted-foreground #A3B0AB; primary #4FB3A3 / primary-foreground #0E1513; gold #D9B865, border #24302D.
> Badges: "New" = primary bg + white text; "Pre-owned" = #F6EFD9 bg + #6B5318 text; "Featured" = gold bg + #1C2321 text.
> Add a test asserting WCAG AA (≥4.5:1) for body text, muted text, the price, every button and every badge text in light and dark.
>
> 2. MOTION (design-system.md §5): GSAP + ScrollTrigger for the home hero and section reveals; Framer Motion for product cards (hover lift and image crossfade), the cart drawer, page transitions and add-to-cart feedback (fly-to-cart plus a toast); AOS for content-page reveals. Everything respects prefers-reduced-motion and mirrors in RTL.
>
> 3. PRODUCT CARD: 4:5 image with a second-image crossfade on hover, type/condition badge, heart favourite toggle (animated), title in 2 lines, price in price-gold, quick "Add to cart" button (disabled with "Sold out" when stock is 0).
>
> 4. FAVOURITES, account-saved: PRD change, favourites move from non-goal to in scope as requirement FAV-01.
> - Backend task: Wishlist model (userId unique, productIds max 100); GET/PUT/DELETE /me/wishlist; POST /me/wishlist/merge for the guest list on login (union, cap 100, unpublished products skipped); customers only; spec first; tests.
> - Web task: guest favourites in localStorage, merge after login (clear only after a successful merge), a favourites page, and a heart count in the header.
>
> 5. LOGIN and REGISTER: split layout with a large lifestyle image panel (placeholder until real photos exist), emerald side panel with a gold accent line, polished form with inline validation, OTP screen with 6 animated inputs and a resend countdown. Both en and ar, mirrored in RTL.
>
> 6. HOME PAGE: full-width hero carousel from admin banners (GSAP text stagger, slow image zoom, gold CTA); category grid (bento style); featured and new-arrivals rows; "Pre-owned picks" row with a short "How resale works" 3-step story section; testimonials marquee and a newsletter or contact strip. Elegant placeholders (emerald pattern with the brand mark) when images are missing (B-022).
>
> 7. CART: redesign the cart drawer and cart page: thumbnails, quantity stepper, remove with undo toast, free-delivery progress bar in gold, clear totals (subtotal, delivery, VAT line only when > 0, total), sticky checkout button on mobile.
>
> Process: update the PRD, screen-specs.md, design-system.md and the task files first, then implement as separate tasks with the normal loop (plan → tests in en and ar → checks incl. build and e2e → /review-task → one commit per task on this branch). Typography: Fraunces / Noto Kufi Arabic for headings, generous whitespace, the radius and shadow tokens only, no hex values in components. Do not push.

## Structured statements

| # | Statement | Ref | Touches |
|---|-----------|-----|---------|
| 1 | New palette "Emerald and gold" on white replaces "Warm Walnut"; light token values as given (background, foreground, card, muted, primary, secondary, gold + text-on-gold, price, border, ring, destructive, success, warning). | SRC-008.1 | design-system §1, `globals.css`, `index.css` |
| 2 | Admin dark values given for background, card, foreground, muted, muted-foreground, primary, gold, border only. | SRC-008.2 | design-system §1, admin `index.css` |
| 3 | `warning` is for icons and badge backgrounds only; badge text uses its darkest shade (shade not specified). | SRC-008.3 | design-system §1, status badges |
| 4 | Badge colours: New = primary/white; Pre-owned = secondary bg + secondary-foreground; Featured = gold + text-on-gold. | SRC-008.4 | design-system §4 |
| 5 | A test asserts WCAG AA ≥ 4.5:1 for body text, muted text, price, every button and every badge text, light and dark. | SRC-008.5 | UI-02, web + admin tests |
| 6 | Motion split: GSAP + ScrollTrigger (home hero, section reveals); Framer Motion (product cards, cart drawer, page transitions, add-to-cart fly + toast); AOS (content-page reveals). All respect `prefers-reduced-motion` and mirror in RTL. | SRC-008.6 | design-system §5, UI-01 |
| 7 | Product card: 4:5 image, second-image crossfade on hover, type/condition badge, animated heart toggle, 2-line title, price in price colour, quick add (disabled "Sold out" at stock 0). | SRC-008.7 | design-system §4, PROD-01 |
| 8 | Favourites move from non-goal to in scope as **FAV-01**, saved on the account. | SRC-008.8 | PRD §3, §5 |
| 9 | Backend: `Wishlist` (userId unique, productIds max 100); `GET/PUT/DELETE /me/wishlist`; `POST /me/wishlist/merge` (union, cap 100, unpublished skipped); customers only; spec first; tests. | SRC-008.9 | api-spec, data-model, backend tasks |
| 10 | Web: guest favourites in localStorage, merge after login (clear only after a successful merge), favourites page, heart count in header. | SRC-008.10 | web tasks, screen-specs |
| 11 | Login/register: split layout with lifestyle image panel (placeholder), emerald side panel with gold accent line, inline validation, OTP with 6 animated inputs + resend countdown; en/ar, RTL. | SRC-008.11 | W-06, AUTH-01..04 (visual only) |
| 12 | Home page: full-width banner hero, bento category grid, featured and new-arrivals rows, Pre-owned picks + "How resale works", testimonials marquee, newsletter **or** contact strip; emerald-pattern placeholders when images are missing. | SRC-008.12 | W-01, ADM-06/07, B-022 |
| 13 | Cart drawer and page redesign: thumbnails, stepper, remove with undo toast, gold free-delivery bar, totals (VAT line only when > 0), sticky mobile checkout button. | SRC-008.13 | W-04, CART-01 |
| 14 | Typography Fraunces / Noto Kufi Arabic for headings; radius and shadow tokens only; no hex values in components. | SRC-008.14 | design-system §2–3, CLAUDE.md rule 2 |
| 15 | Process: docs first (PRD, screen-specs, design-system, task files), then separate tasks, one commit per task on this branch, normal review loop, **do not push**. | SRC-008.15 | delivery |

## Not stated (raised as open questions in `05-delivery/cr-007-proposal.md`)

Warning "darkest shade" value; dark values for secondary / destructive / success / warning / ring; fate of the `accent` token; form-field border contrast; wishlist PUT/DELETE shape; newsletter vs contact strip; whether the home layout stays admin-section-driven; toast library; brand mark for placeholders (B-006 still open); page-transition limits in the Next.js App Router.

## Addendum (SRC-009, CR-008): "REDESIGN v2, the owner rejected the current look as templated"

Source: owner brief pasted after CR-007 was delivered. Status: **recorded; the plan is proposed in `03-design/design-system.md` v2, `04-architecture/adr/ADR-015-najdi-arch-visual-identity.md` and `05-delivery/cr-008-plan.md`, waiting for approval.**

Key statements: signature element is the Najdi arch (hero and category tiles, mirrored in RTL); palette paper `#FFFFFF`, ink `#14201D`, emerald `#0F4C45`, date gold `#B8913A` (decorative only), sand `#EFE9DD` (backdrops, not the page), stone `#6B726F`; Readex Pro headings, IBM Plex Sans and IBM Plex Sans Arabic body; slim header with prominent search; arched hero with "Shop new" and "Shop pre-owned"; horizontal arch category row; one New / Pre-owned shelf; product grid without borders or shadows; product page with sticky buy box and a condition report for pre-owned; emerald footer; one GSAP moment on load, Framer Motion for user actions only, no generic reveals, AOS dropped; avoid the listed generic AI tells; native en and ar copy; process: plan first, stop for approval, then tasks with screenshots at 390 and 1440 in `/ar` and `/en`, one commit per task, do not push.

## Addendum 3 (SRC-010, CR-009): "Home page redesign v4"

Source: owner brief, 2026-11-24. Status: **recorded; the plan is in `05-delivery/cr-009-plan.md` and `04-architecture/adr/ADR-016-home-v4-photo-first-split-hero.md`, waiting for approval.** Branch `redesign/home-v4` (from `autopilot/2026-11-24`).

Key statements: the owner rejected the current home page as not professional enough; target is the look of leading furniture e-commerce sites (photo-first, white space, large lifestyle photography, calm UI) with one idea that is ours, new and pre-owned. Remove the arch from the home page (hero and category tiles) and note it in ADR-015. Sections in order: (1) announcement bar "Cash on delivery across Saudi Arabia" (no admin editing); (2) split hero, two full-height photo panels "New furniture" and "Pre-owned, half the price", a short line and one button each, text on a soft bottom gradient, existing admin banner as a slim promo strip, one GSAP load moment, reduced motion respected; (3) shop by room, large image tiles, 12 px radius, name under the image, horizontal snap on mobile; (4) Best sellers / New arrivals rail with tabs, card with sand backdrop, hover second image, heart, quick add, name, price in SAR, condition chip for pre-owned, no borders or shadows; (5) shop the look, one large room photo with 3 to 4 hotspot buttons opening a small product card, keyboard and touch, admin data only if cheap otherwise seeded; (6) pre-owned explained, emerald band, 3 steps (we photograph it, we grade it, you pay when it arrives), approved copy only, no inspection claims (B-036); (7) pre-owned picks rail; (8) trust strip with only true facts; (9) footer unchanged. Rules: approved or listed-for-approval copy only, en and ar, RTL correct; next/image with correct sizes and priority only on the hero; LCP and CLS not worse than now, measured before and after; AA contrast tests for every new surface; no new npm dependencies. Process: build the home page only, run web checks, screenshots at 390 and 1440 in /ar and /en plus hover and hotspot states into `03-design/screens-v4/`, then stop and show; do not touch other pages. No push, no `demo:reset` or other data-deleting command.

## Addendum 4 (SRC-011, CR-010): "Admin-selectable color theme"

Source: owner brief, 2026-11-24. Status: **recorded; the plan is in `05-delivery/cr-010-plan.md` and `04-architecture/adr/ADR-017-admin-selectable-theme-presets.md`, waiting for approval. Plan only; implementation starts after CR-009 (home v4) is approved.**

Key statements: Admin > Settings > Appearance offers 4 to 5 preset themes (Emerald default, Walnut, Charcoal, Sand and one more proposed by me), no free colour picker. Each preset is a full token set (primary, primary-foreground, accent, surface, muted, border, price, focus ring) for the web and a matching admin preview, and every preset must pass the existing WCAG AA gate in tests. Backend: `themeId` in the existing settings document, validated against the preset list with a zod enum, admin-only PATCH with the existing CSRF and audit rules, exposed in the public settings response. Web: apply the theme on the server as CSS variables on `<html>` (no flash), refresh within a short cache window using the existing revalidation approach (mechanism to be proposed). Admin: preset cards with a live preview of a product card, a button and a price, then Apply. Deliverables: requirement IDs, OpenAPI update, tests, traceability. No push; no `demo:reset` or other data-deleting command.

## Addendum 5 (SRC-012, CR-011): "Soft luxury" redesign, banners and customer management

Source: owner brief, 2026-11-24, after reviewing the running site. Status: **recorded; the plan is in `05-delivery/cr-011-plan.md` and `04-architecture/adr/ADR-018-soft-luxury-storefront.md`, waiting for approval. CR-009's split hero is cancelled; CR-010 stays approved.** Work stopped at a clean point (`9f0f879`, nothing uncommitted).

Problems named: the hero photo fills a quarter of a wide screen with empty white around it, thin light headings, tiny arch category tiles with a native scrollbar and a cut-off tile, large gaps between sections, content in a narrow column, a login page whose right half is an empty arch. Wanted: "sweet and luxurious", unique, fully responsive (360 to 1920 px, en LTR and ar RTL).

Direction "Soft luxury": Bodoni Moda (Latin) and El Messiri (Arabic) headings via next/font/google, IBM Plex body; large confident headings (hero 56 to 72 px), body 16 to 17 px; primary of the active preset, a champagne gold for decorative lines and a soft blush surface (theme tokens, AA gate); container to 1440 px, full-bleed photo bands, no empty gaps, image corners 4 to 8 px, no native scrollbars on rails; motion limited to carousel crossfade, slow image zoom and hover zoom, reduced motion respected; arch removed from the whole storefront.

Checkpoint 1: hero carousel (admin banners, three static fallback slides, crossfade 700 ms, 6 s zoom, 6 s autoplay, progress bars, arrows, swipe, keyboard, pause on hover and focus plus a visible pause button, carousel ARIA, priority on the first image only, LCP and CLS within the CR-009 budget); editorial bento categories (1 large + 4 small, 2 columns on tablet and mobile, no horizontal scrollbar, hover zoom); split-screen auth pages (login, register, verify OTP, forgot, reset) with floating labels, show/hide password, live password rules, six-box OTP with paste and resend timer, clear errors. Screenshots at 390, 768, 1440, 1920 in /en and /ar into `03-design/screens-v5/`, then stop.
Checkpoint 2: the same system on every other storefront page (header transparent over the hero and solid on scroll, rails and cards, listing with sticky filters and a mobile bottom sheet, product page with gallery, zoom and sticky buy box, cart, checkout, order success, account, orders, wishlist, notifications, static pages, 404 and empty states, footer). Then stop.
Checkpoint 3 (admin): banners list (table, thumbnail, status toggle, schedule, drag to reorder, empty state, delete confirmation) and editor (two columns, en/ar tabs, image upload with crop preview, button link, schedule, live preview with desktop/mobile toggle); customers (list with search, status filter and pagination, detail page, reuse the existing blocked chip): block/unblock with a required reason (revokes refresh tokens, disconnects sockets, blocks login, reset and new orders, generic message), update name and phone only (+966), soft delete with anonymisation and orders kept (refused with PENDING or CONFIRMED orders, the admin types the customer's email), never another admin or oneself, who and when recorded, one log line per action without personal data; zod, OpenAPI, requirement IDs, tests for every rule including authz.
Rules: approved copy only (every new en and ar string is listed in the plan); no new npm dependency without asking; no push, no deploy, no `demo:reset` or any data-deleting command; one commit per task; no test weakened or deleted.
