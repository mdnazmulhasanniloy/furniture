# Redesign v2 plan: review summary (CR-008)

The v2 plan is written and I've stopped for your approval. The docs are uncommitted, and no code or tokens have changed.

The files are:
- `project-docs/03-design/design-system.md` (rewritten as v2: tokens, type scale, arch, components, ASCII wireframes for home, listing, product, cart and auth, motion, copy in en/ar)
- `project-docs/04-architecture/adr/ADR-015-najdi-arch-visual-identity.md` (supersedes the visual parts of ADR-014; contrast rules stay)
- `project-docs/05-delivery/cr-008-plan.md` (tasks T-052 to T-058, admin T-079, screenshot protocol)
- a note appended to `client-notes-2026-11-24.md`

## Where I changed your plan, and why

**Contrast.** I checked your palette against the 4.5:1 text rule, and three values need a small change:
- **Stone `#6B726F` as text:** it is 4.08:1 on sand. Text uses `#5C6360` (5.1 on sand). Your Stone stays for hairlines, icons and placeholders.
- **Price:** the old `#86672A` is 4.36:1 on sand. It becomes `#7A5E22` (5.0 on sand).
- **Form-field borders on sand:** 2.97:1. Fields sit on paper only.
- **Date gold:** 2.9:1 on paper, so it is a decorative hairline only, as you said.

**Palette.** Sand replaces the old cool grey and the cream secondary, so the neutrals are paper, sand, ink and stone.

**AVOID list.** Reviewing v1 against it, the criticism was fair:
- The serif display face, the bordered cards with one shared shadow, the shimmer CTA, the gradient placeholder, the scroll reveals, the marquee, the page transition, the "Step n" labels over step titles, and "Pre-owned · grade" meta strings all go.
- The condition chip moves under the image so it never sits on a photo.
- The how-pre-owned steps become an open row with large numerals (it is a real sequence).
- I also cut my own first-draft accessories. Gold survives in only two places: the outline arch behind the hero and the wordmark underline.

**One timeline on load.** The hero arch reveals, the gold outline draws, then the headline settles. The hero image is already painted, so LCP is not delayed. The headline is a single weight (300), with no accented word.

## Decisions I need from you (ADR-015, Q-1 to Q-7)

- **Q-1, shelf data (blocks the home task):** the one shelf would show the admin's New arrivals and Pre-owned picks sections, falling back to the newest products by type. Featured, Promo banner and Testimonials stay in the admin but leave the default home. Is that right?
- **Q-2, condition report (blocks the product-page task):** it uses only real data: grade, the existing condition notes, the product's extra photos, and the line "Inspected by Furnixa". That line is a promise to customers. Is every pre-owned item actually inspected? The grade wording is a draft for you to approve.
- **Q-3, admin typography:** should the admin get the same fonts?
- **Q-4, removals:** do you approve dropping AOS, the page transition, the marquee and the scroll reveals, and moving the contact strip into the footer?
- **Q-5, banner crops:** banners are landscape and the arch is portrait. I propose a centre crop plus a hint in the admin editor, with no new backend field.
- **Q-6, hero rotation:** a slow crossfade every 7 seconds, paused on hover and focus, no zoom.
- **Q-7, footer copy:** I'll draft the COD sentence and the cities-served wording in en and ar for your review.

## Risks to know about

- Readex Pro has a width axis, but next/font might reject it; the first task checks that, with weight-only as the fallback.
- The sand-multiply trick on product images needs near-white studio backgrounds. I'll check it on the demo images.

Reply with approvals or changes to Q-1 to Q-7 and I'll start with T-052. Each page will get 390px and 1440px screenshots in `/ar` and `/en`, a critique, and one commit per task, with nothing pushed.
