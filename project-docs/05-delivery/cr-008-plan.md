# CR-008 plan: Najdi arch redesign (v2)

Source: `SRC-009` (owner brief, 2026-11-24, pasted in the conversation). Design: `03-design/design-system.md` v2, `ADR-015`. Status: **approved 2026-11-24 (ADR-015 Accepted). Building in task order; progress in the task files.**

## Owner brief, in short (SRC-009)

Version 1 was rejected as templated. Signature: the Najdi arch on the hero image and category tiles. Palette: paper, ink, emerald, date gold (decorative), sand (backdrops only), stone. Type: Readex Pro headings, IBM Plex Sans and IBM Plex Sans Arabic body. Layout: slim header with a prominent search, arched hero with two actions, scrolling row of arch category tiles, one New / Pre-owned shelf, borderless product grid, sticky buy box and condition report, emerald footer. Motion: one GSAP moment on home load, Framer Motion only for user actions, no generic reveals. Avoid the generic-AI list. Native Arabic and English copy.

## Tasks (IDs provisional; next free after CR-007: web T-052, admin T-078 is taken by the demo-data task already, so admin uses T-079)

| ID | Task | Depends | Req |
|---|---|---|---|
| web T-052 | Foundation v2: tokens, Readex Pro + IBM Plex loading per locale (check the `HEXP` axis), `Arch` component, AA tests updated, remove v1 leftovers (`.shimmer`, `.pattern-emerald`, `AosInit`, `HomeReveals`, `template.tsx`) | approval | UI-01, UI-02 |
| web T-053 | Header and footer: slim header with prominent search, mega-menu, favourites/cart/account; emerald footer with contact, cities served, COD | T-052 | UI-01, ADM-09 |
| web T-054 | Home: GSAP arch moment, arched hero fed by banners, arch category row, one New / Pre-owned shelf, How pre-owned works | T-052, T-053 | CAT-01, ADM-06, ADM-07 |
| web T-055 | Listing and product tile: borderless tiles on sand, heart, chip under image, quick add, filters (sheet on mobile) | T-052 | PROD-01, FAV-01 |
| web T-056 | Product page and condition report: gallery, sticky buy box, condition block | T-055 | PROD-02 |
| web T-057 | Cart and checkout restyle: flat summary, drawer, sticky bar | T-052 | CART-01, ORD-01 |
| web T-058 | Auth pages: arch image panel, form, OTP | T-052 | AUTH-01..04 |
| admin T-079 | Admin tokens and fonts follow v2 (Q-3); banner editor hint for the arch crop (Q-5) | T-052 | UI-01, UI-02, ADM-06 |

Each task: plan, tests in en and ar, typecheck, lint, i18n, build, e2e, AA gate, `/review-task`, one commit on this branch. No push.

## Screenshot self-critique (every page, before its commit)

Playwright, demo data from `npm run demo:reset`, viewports 390 and 1440, `/ar` and `/en` (four shots per page). For each page write down what looks generic or unbalanced, fix it, then remove one accessory. Screenshots go to `project-docs/05-delivery/screens/cr-008/` with the critique in the task note.

## Open questions

See `ADR-015`, Q-1 to Q-7. Q-1 (shelf data), Q-2 (condition report promises) and Q-4 (removals) block T-054 and T-056; the others have a proposed default.
