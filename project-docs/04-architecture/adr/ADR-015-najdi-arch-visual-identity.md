# ADR-015: Najdi arch visual identity, Readex Pro type, quiet motion

Status: **Accepted 2026-11-24** (CR-008, SRC-009; owner approved the plan and answered Q-1 to Q-7, see "Owner answers") · Source: UI-01, UI-02, PROD-01, PROD-02, CART-01, AUTH-01..04 · **Supersedes the visual parts of ADR-014** (palette values, display type, motion split, home composition). **Unchanged from ADR-014:** the token contract (colour only from CSS variables, no hex in components), the AA contrast gate (4.5:1 text, 3:1 graphics, light and admin dark), reduced-motion and RTL rules, LCP < 2.5 s (PRD G4), sonner, `--gold-strong` for meaningful gold graphics.

## Context

The owner rejected the v1 look as templated. Looking at what v1 actually shipped, the criticism is fair: a cream-tinted secondary, a serif display face, identical bordered cards with the same soft shadow, a "shimmer" CTA, scroll reveals on every section, a marquee, a page transition, a contact strip with a gold bar above its heading, and a "Step n" label above each step. The brief for v2 is one signature (the Najdi arch), a disciplined palette, a new type system and motion only where it means something.

## Decision (proposed)

1. **Signature: the arch.** One SVG `clipPath` (`objectBoundingBox`, symmetric, so RTL needs no mirroring) masks exactly three things: the hero image (with a thin date-gold arch outline behind it), the category tiles, and the auth image panel. Everything else is square and quiet.
2. **Palette:** paper `#FFFFFF`, ink `#14201D`, emerald `#0F4C45`, sand `#EFE9DD` (image backdrops and quiet surfaces, never the page), stone, date gold `#B8913A` (decorative lines and icons only). Contrast-driven adjustments are listed below.
3. **Type:** Readex Pro for headings, numerals and buttons in both scripts (weight and width axes are the design element); IBM Plex Sans / IBM Plex Sans Arabic for body. Major-third scale, 65ch measure, more line-height for Arabic, no letter-spacing on Arabic.
4. **Product tiles without borders or shadows:** photo multiplied onto a sand backdrop, heart in the corner, chip under the image.
5. **Home is composed, not stacked:** hero (arch + headline + two actions), a horizontal row of arch category tiles, ONE shelf with a New / Pre-owned segmented switch, the real 3-step "How pre-owned works", the emerald footer. The contact strip, the testimonials marquee and the repeated product sections are removed from the default composition (see Q-1).
6. **Product page:** large gallery, sticky buy box (bottom bar on mobile), a "Condition report" block for pre-owned items built only from real data.
7. **Motion:** one GSAP timeline on home load (arch reveal, gold outline draw, headline settle). Framer Motion only for answers to user actions (heart, fly-to-cart and toast, drawer, OTP boxes, switch, mega-menu). Removed: `HomeReveals` scroll reveals, AOS, the page enter transition, the marquee, the hero zoom and parallax, the shimmer.
8. **Fonts load per locale as today** (`preload: false`, scoped `@font-face`): en gets Readex Pro latin + IBM Plex Sans; ar gets Readex Pro arabic + IBM Plex Sans Arabic. The e2e check "each locale downloads only its own fonts" stays.

## Review against the AVOID list (what changed in my first draft, and why)

| AVOID item | Finding in the plan or in v1 | Change |
|---|---|---|
| Cream page background | v1 `--secondary` `#F6EFD9` and `--background` white were fine, but the cream chip sat on photos | Cream removed. Sand is a backdrop and chip colour only; the page stays white |
| Serif display + terracotta | Fraunces (serif) in v1; terracotta already gone | Readex Pro, no serif anywhere |
| Identical rounded cards, same grey shadow | v1 product card, cart summary, contact strip, how-resale cards, toasts all used the same border and `shadow-card` | Product tiles lose border and shadow; how-resale cards become an open 3-column sequence; the cart summary is a flat block with a hairline; the shadow token survives only on floating layers |
| Gradient washes | `.pattern-emerald` placeholder used a radial and a repeating gradient | Placeholder becomes a flat sand block with the wordmark and a hairline arch outline. No gradients |
| ALL-CAPS eyebrow labels | The plan had none, but v1 has "Step n" labels over step titles | Steps use a large numeral beside the title (a real sequence), no label |
| "01/02/03" markers | Only for How pre-owned works | Kept there, nowhere else |
| "A · B · C" meta strings | `badge.preowned` is "Pre-owned · {grade}" in v1 | Becomes "Pre-owned, good" and "مستعمل بحالة جيدة": plain words, no separators |
| → on buttons | None in the plan; v1 has no arrows either | Rule written down: none |
| One word accented | None; I also removed any idea of a two-weight headline | The hero headline is one weight (300). The weight contrast is between hero and section titles, not inside a headline |
| Accessories | My first draft added a gold bar above every section title, a gold accent on the wordmark and on the footer, and a gold hairline under the header | Only two gold gestures survive: the arch outline behind the hero and the wordmark underline (until a real logo). The footer, header and section titles carry no gold |

## Contrast corrections to the owner's palette (computed, WCAG)

| Pair | Ratio | Finding | Decision |
|---|---|---|---|
| Stone `#6B726F` on paper / on sand | 4.93 / **4.08** | Fails 4.5:1 on sand | Text uses `--muted-foreground` `#5C6360` (6.2 / 5.1). `#6B726F` stays as `--stone` for hairlines, icons and placeholders only |
| Price `#86672A` (ADR-014) on sand | **4.36** | Fails on sand | `--price` `#7A5E22` (6.1 on paper, 5.0 on sand) |
| Date gold `#B8913A` on paper / on emerald | 2.94 / 3.34 | Below 4.5 as text, below 3 on paper as a graphic | Decorative lines and icons only, as the brief says; meaningful gold graphics use `--gold-strong` |
| Form-field border `#7D8A85` on sand | **2.97** | Fails 3:1 on sand | Fields sit on paper only (3.6:1). A sand-backed field is not allowed |
| Ink on paper / sand, white on emerald, emerald on sand | 16.8 / 13.9, 9.8, 8.1 | Pass | None |

## Consequences

- `design-system.md` is rewritten (sections 1 to 10); old sections 6 and 7 are folded in. Admin follows the same tokens and, unless the owner says otherwise (Q-3), the same two font families.
- New work after approval: tokens and fonts, `Arch` component (clipPath + gold outline), header and footer, home (hero, arch row, shelf, how-pre-owned), listing and tile, product page and condition report, cart and checkout, auth pages, admin tokens. Tasks are drafted in section "Tasks" of `cr-008-plan.md`.
- Existing v1 code to delete: `HomeReveals`, `AosInit` and its use, `template.tsx`, `.shimmer`, `.pattern-emerald`, the marquee, the contact strip, the repeated product sections as separate blocks.
- Tests that encode v1 (`ui-01` white background, testimonials marquee, contact strip, page transition, AOS) are replaced by tests for v2; they are not weakened, they describe removed features.
- Risk: next/font may reject the `HEXP` axis for Readex Pro. Fallback is weight only (`wght`) with `font-stretch` unused; verified in the first task before anything depends on it.
- Risk: the sand-multiply trick needs photos with a near-white studio backdrop. Photos with a coloured backdrop will show as a sand-tinted rectangle. Checked on the demo images in the screenshot pass.

## Alternatives considered

- Keep Fraunces for headings and only change colours: rejected, the serif is on the AVOID list.
- Arch on every card: rejected, it would dilute the signature and cost image area.
- Use stone `#6B726F` for all secondary text: rejected, it fails on sand.

## Open questions for the owner (answers needed before building)

| # | Question | Proposed answer |
|---|---|---|
| Q-1 | The ONE shelf replaces several admin-ordered sections (ADM-07). Which data feeds it? | The shelf shows the products of the `NEW_ARRIVALS` and `RESALE_PICKS` sections (the admin keeps choosing them) and falls back to the newest products by type. `FEATURED_PRODUCTS`, `PROMO_BANNER` and `TESTIMONIALS` stay available in the admin but are not on the default home; a featured product gets a "Featured" chip in the shelf. Confirm, or tell me which sections must remain visible |
| Q-2 | Condition report content. It makes promises to customers. | Data from the product only: grade (existing), `conditionNotes` (existing, both languages), the product's extra photos as close-ups, and the static line "Inspected by Furnixa" plus the grade scale wording. Owner must approve the grade definitions and confirm every pre-owned item really is inspected. No invented checklist or inspector name |
| Q-3 | Admin gets Readex Pro and IBM Plex too? | Yes, same families (one identity), via the existing font loading; palette tokens follow either way |
| Q-4 | Dropping AOS, the page transition, the marquee and the scroll reveals, and removing the contact strip from the home (contact lives in the footer). | Approve all four removals |
| Q-5 | Banner images are landscape today; the hero arch is portrait (4:5). | Crop with `object-position: center` and add one line of guidance to the admin banner editor ("the middle of the image shows inside the arch"); no new backend field. A focal-point field is a later option |
| Q-6 | Hero rotation. | Slow crossfade every 7 s, paused on hover and focus, off under reduced motion, no zoom |
| Q-7 | Footer "cities served" and COD wording. | Cities come from Site Settings delivery cities (active only); COD sentence is mine to draft in en and ar for your review |

## Owner answers (2026-11-24)

- Q-1 yes: one shelf from the admin's NEW_ARRIVALS / RESALE_PICKS config, falling back to the newest products by type. FEATURED_PRODUCTS, PROMO_BANNER and TESTIMONIALS stay in the admin, hidden from the default home; if an admin turns one on it renders below the shelf in the same quiet style.
- Q-2: the answer arrived with the choice left unfilled. **Working default, not a claim of inspection:** the report says "Photos and condition notes by Furnixa" (ar: "الصور وملاحظات الحالة من فرنيكس") and the app never states that an item was inspected. If every pre-owned item is in fact inspected, the owner switches one message string per language (`product.condition.byline`) to "Inspected by Furnixa". The grade wording draft is approved; the owner reads it in the T-056 screenshots.
- Q-3 yes: admin uses Readex Pro headings and IBM Plex body, calm: no arch, no hero motion.
- Q-4 approved: AOS, page transition, marquee and scroll reveals dropped; contact strip moves to the footer; GSAP only for the single hero moment, Framer Motion for user-action feedback; remove the aos dependency (and its types) when nothing uses it.
- Q-5 approved: centre crop into the arch plus a crop-preview hint in the admin banner editor; no backend change.
- Q-6 approved: crossfade every 7 s, paused on hover and focus; under prefers-reduced-motion no auto-rotation, manual dots only.
- Q-7 approved: COD sentence and cities-served wording drafted in en and ar; the owner reviews them in the screenshots.
- Readex Pro: if next/font rejects the width axis, weights only.
- Screenshots for review are saved in `03-design/screens-v2/`.
