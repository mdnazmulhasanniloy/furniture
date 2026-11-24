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
