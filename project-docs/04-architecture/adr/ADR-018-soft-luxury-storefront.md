# ADR-018: Soft luxury storefront (serif headings, hero carousel, no arch)

Status: **Proposed 2026-11-24** (CR-011, SRC-012; waiting for owner approval) · Source: UI-01, UI-02, UI-04, CAT-01, ADM-06, AUTH-01..04 · **Supersedes the home composition of ADR-016 (split hero cancelled) and the arch identity of ADR-015 on the storefront.** Keeps ADR-017 (theme presets).

## Context

The owner reviewed the running site and rejected the direction again: the hero photo filled a quarter of a wide screen, headings were thin and light, category tiles were tiny arches with a native scrollbar and a cut-off tile, sections left large gaps, content sat in a narrow column, and the login page showed an empty arch. The site must feel "sweet and luxurious", unique, and be fully responsive from 360 to 1920 px in en (LTR) and ar (RTL).

## Decision (proposed)

1. **Type:** Bodoni Moda (Latin headings) and El Messiri (Arabic headings), weights 600 and 700, via `next/font/google`; IBM Plex Sans and IBM Plex Sans Arabic for body (16 to 17 px). Per-locale font scoping stays (each locale downloads only its own fonts). No npm dependency. Readex Pro leaves the web.
2. **Colour as theme tokens:** the active preset's primary stays; add `--blush` (soft surface) and `--champagne` (decorative lines and details, never text). Both are part of every CR-010 preset and pass the AA gate. No component uses a hex value.
3. **Layout:** container up to 1440 px, full-bleed bands where photos lead, one vertical rhythm token, image corners 4 to 8 px, no native scrollbars on rails (keyboard and arrow buttons kept).
4. **Home hero:** a full-bleed carousel (85vh desktop, 70vh mobile, min 480 px) fed by the admin banners, with three static fallback slides. Crossfade, slow zoom, autoplay with a visible pause button (WCAG 2.2.2), progress bars, arrows, swipe, keyboard, carousel ARIA, reduced motion respected. Only slide 1 has priority.
5. **Categories:** an editorial bento grid (1 large + 4 small on desktop, 2 columns on tablet and mobile) with hover zoom; no horizontal scroll.
6. **Auth pages:** split screen with a lifestyle photo and one true brand line, floating labels, live password rules, a six-box OTP.
7. **Motion:** only carousel crossfade, slow image zoom and hover zoom. The GSAP load moment and any scroll animation are removed. Reduced motion disables autoplay and zoom.
8. **The arch is removed from the whole storefront** (the `Arch` component is deleted in T-094). ADR-015 and ADR-016 carry notes.
9. **Admin banners and customer management** are part of the same change (checkpoint 3) but do not depend on the storefront design.

## Consequences

- CR-009 web tasks T-081 to T-084 are cancelled before any code; T-080 (`SHOP_THE_LOOK` API) stays and the look section is restyled in checkpoint 2 if the owner keeps it (CR-011 Q-2).
- CR-010 tokens grow from 12 to 14 variables per preset; T-086 is written with them.
- LCP and CLS budgets from CR-009 still apply; the full-height hero is the main risk and is measured before and after.
- Bodoni Moda's hairlines are weak at small sizes; used from 28 px up (CR-011 Q-10).
- Customer management adds fields to `User` (additive) and a soft-delete that anonymises personal data while orders are kept.

## Open points

See `05-delivery/cr-011-plan.md` section 9 (Q-1 to Q-10).
