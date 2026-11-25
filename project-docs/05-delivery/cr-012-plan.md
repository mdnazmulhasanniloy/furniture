# CR-012: Framer Motion scroll reveals on the home page (plan, proposed 2026-11-25)

Source: `01-discovery/client-notes-2026-11-25.md` (SRC-013) · Decision: `04-architecture/adr/ADR-019-home-scroll-reveals.md` (Proposed)
Status: **approved by the owner 2026-11-25; documents applied, tasks open, no code written yet.** Branch `feat/home-motion`, created off `main`. Not merged to `main` and not deployed without the owner's approval.

## 0. State of the branch

`main` is at `054d841` (merge of `feat/theme-presets`, T-086 to T-088) and equals `origin/main`. Every other branch is merged into it except `fix/per-app-refresh-cookie`, which is one commit ahead (`cd733af`, T-111/B-042) and still unmerged; that commit touches auth cookies only, so `feat/home-motion` is cut from `main` and does not need it. (An earlier draft of this plan said `main` was at `cd733af` — it was not.)

Nothing in this CR has been implemented. The three documents written on 2026-11-25 are the client notes, ADR-019 and this plan; the edits in section 4.1 to 4.4 are applied, 4.5 (the test gate) belongs to T-112 because it is code.

## 1. What changes, in one paragraph

The home page gets scroll-triggered reveals, built with Framer Motion through one shared primitive, under a single restrained grammar (opacity + 24 px `y`, 450 ms, 60–80 ms stagger, plays once, `-10%` trigger margin). The hero is excluded because it holds the LCP image. Two extra touches are added beyond scroll: the champagne hairlines draw in, and the shelf's New / Pre-owned tab switch crossfades. Everything collapses to a static final state under `prefers-reduced-motion` and with JavaScript off. Three documents and one test gate change first; no other page is touched; no new npm dependency; no new user-facing string.

## 2. Motion spec, per home section

Sections are listed in page order. "Reveal" means the shared primitive with the grammar from ADR-019 decision 4.

| # | Section | File | Server/client today | Motion |
|---|---|---|---|---|
| 1 | Hero carousel | `components/home/hero.tsx` | client | **None added.** Keeps crossfade 700 ms + 6 s zoom. Not wrapped in a reveal (LCP). |
| 2 | Category bento | `components/home/category-row.tsx` | server | `RevealGroup` over the tiles: each tile opacity 0→1, `y` 24→0. Existing `.zoom-on-hover` untouched. |
| 3 | Shelf (New / Pre-owned) | `components/home/shelf.tsx` | client | Heading + tab bar one `Reveal`; rail cards a `RevealGroup`, first view only. Tab switch: crossfade 180 ms on the panel (`AnimatePresence`, `mode="wait"`), no height animation. |
| 4 | Shop the look | `components/home/shop-the-look.tsx` | client | Photo `Reveal` (opacity + `y` 24; **no scale** — the hotspots are percentages of the photo box, see T-085, so the box must not be transformed in a way that moves them). Hotspot dots fade in 120 ms after the photo, stagger 50 ms. |
| 5 | Optional admin sections | `components/home/home-sections.tsx` (`SectionShell`, `OptionalSection`) | server | `SectionShell` wraps its heading/subtitle in one `Reveal`; `FEATURED_PRODUCTS` and `TESTIMONIALS` grids are a `RevealGroup`; `PROMO_BANNER` reveals the text column and the photo together (one group). |
| 6 | How pre-owned works | `components/home/how-resale.tsx` | server | Heading `Reveal`; the three steps a `RevealGroup`; each step's `border-t-2 border-champagne` hairline becomes a `RevealLine` that draws `scaleX` 0→1, 400 ms, origin at the inline start (flips in RTL). |
| 7 | Trust strip | `components/home/trust-strip.tsx` | async server | The facts a `RevealGroup`, same `RevealLine` hairline. |

Stagger is never passed per section: the group works it out from how many children it has (70 ms, compressed towards a 60 ms floor for a long row). A section that wants a second beat uses `delay`, nothing else.

Out of scope for this CR: header, footer, shop, product, cart, checkout, account, auth and static pages (SRC-013.4).

## 3. The shared primitive

New file `web/src/components/motion/reveal.tsx`, `"use client"`, no other new file.

```
<Reveal>                     one block, opacity + y
<RevealGroup>                parent: hands each RevealItem child its own delay
<RevealItem>                 one child of a group
<RevealLine>                 the champagne hairline, drawn (scaleX, origin at the inline start)
<RevealNoScript>             the one <noscript> override, rendered once per page
```

`RevealLine` lives here rather than in the sections that use it, so the gate test's "scroll motion in exactly one
file" assertion stays true and the hairline shares the same constants.

Rules it enforces, so no caller can drift from the grammar:

- Props are limited to `as` (element), `delay` and `className`. There is no duration, easing or distance prop: 24 px, 450 ms and the easing are constants in the file (owner Q-3), so no caller can drift from the grammar.
- Children are always in the DOM. Opacity and transform only; never `display: none`, never `visibility: hidden` (so Playwright, jsdom and crawlers all see the content).
- `useMotionPrefs()` from `web/src/lib/use-motion-prefs.ts` — the one hook every animation in the storefront reads, which itself wraps `useReducedMotion` and the writing direction. When `reduced` is true the component renders a plain element with no `motion` wrapper, no initial state and no transition. Its `dir` is unused here (the reveal moves on `y` only, and `RevealLine` flips through a logical CSS class so it still works with JavaScript off), but the hook is reused rather than the media query read again. Consequence: a reveal needs the intl provider in scope, because that hook reads the locale — true on every storefront page, and the T-112 test wraps accordingly.
- A `<noscript>` style block forces the final state, so the page is complete without JavaScript (Q-6). It is rendered
  once, by the home page itself (`app/[locale]/page.tsx`) — not the layout, because the home page is the only page
  with scroll motion. T-112 landed it there rather than leaving it to T-113, so the guarantee never had a gap.
  Note for anyone testing it: React's **client** renderer drops the children of `<noscript>`, so a jsdom render shows
  an empty element and proves nothing. The server HTML is both the real delivery path and the only thing a visitor
  without JavaScript receives, so the test asserts `renderToStaticMarkup` output.
- `viewport={{ once: true, margin: "-10% 0px" }}`.
- Server components can wrap their children with it without becoming client components.
- **Wraps, never replaces.** A caller keeps its own `<section>`, `data-testid`, `aria-labelledby` and ids and puts the
  reveal inside, so no existing test has to be rewritten to find a moved attribute.
- **The group staggers through React context, not Framer variant propagation.** `RevealGroup` counts its children,
  computes the stagger and gives each child its delay through a context provider that renders no element of its own
  (so a `<ul>`/`<li>` pair and a CSS grid stay intact). Each item then has its own view trigger, which is what makes a
  long rail stagger within the part the visitor can actually see instead of animating cards that are still off screen.
- **No IntersectionObserver means the final state.** The check is read through `useSyncExternalStore` — the same way
  `useReducedMotion` reads its media query — so it is available during render without an effect (the React compiler's
  lint rule rejects `setState` inside an effect, which was the first attempt in T-112). The server snapshot says the
  observer is present, so the server sends the hidden first-paint state; a browser with JavaScript but without the
  observer reports otherwise on hydration and settles visible. It fails visible, never blank.

## 4. Proposed edits to the documents (to apply **after** confirmation, in the same commit as the primitive)

### 4.1 `03-design/design-system.md` — summary line 17

| | |
|---|---|
| Now | "**Motion:** hero crossfade 700 ms, slow 6 s zoom, tile hover/focus zoom (`.zoom-on-hover`, scale 1.04, 400 ms). Nothing on scroll; GSAP leaves the home page. Reduced motion: no autoplay, no zoom." |
| Proposed | "**Motion:** hero crossfade 700 ms, slow 6 s zoom, tile hover/focus zoom (`.zoom-on-hover`, scale 1.04, 400 ms). Home sections reveal once on scroll (Framer Motion, opacity + 16–24 px, 450 ms, CR-012); GSAP stays off the home page. Reduced motion: no autoplay, no zoom, no reveal." |

### 4.2 `03-design/design-system.md` — §7 Motion table and the paragraph under it

Add one row:

| Where | Library | What |
|---|---|---|
| **Home sections on scroll (home page only)** | Framer Motion | Each block reveals the first time it is seen: opacity 0→1 with a 16–24 px rise, 450 ms ease-out, children staggered 60–80 ms (capped at ~600 ms per row), trigger margin −10 %, `once`. `y` only, never `x`, so nothing mirrors in RTL. The champagne hairlines draw `scaleX` 0→1 from the inline start. The hero is excluded (LCP). One shared primitive (`components/motion/reveal.tsx`); GSAP, ScrollTrigger and AOS stay out. |

And amend the "Removed from v1" paragraph:

| | |
|---|---|
| Now | "Removed from v1: scroll reveals on every section, AOS, the page enter transition, the testimonials marquee, the hero zoom and parallax, the shimmer CTA." |
| Proposed | "Removed from v1: AOS, the page enter transition, the testimonials marquee, the hero parallax, the shimmer CTA. Scroll reveals on *every* section were removed with them in v2 and return in CR-012 in a narrower form — home page only, one Framer primitive, plays once (ADR-019); a reveal is never added to the hero or to a page outside the home page." |

The last sentence of that paragraph ("Under `prefers-reduced-motion` the hero is shown complete and nothing moves except what the user triggers") stays true and is kept, with "and reveals render in their final state" appended.

### 4.3 `02-product/PRD.md` §5.7 — amend UI-01 and add UI-05

UI-01 sentence, now: "Motion is restrained (CR-011, UI-04): hero carousel crossfade, slow image zoom and hover zoom only, nothing on scroll; …"
Proposed: "Motion is restrained (CR-011, UI-04; CR-012, UI-05): hero carousel crossfade, slow image zoom, hover zoom, and a once-only reveal of the home sections on scroll; …"

New requirement, after UI-04:

> **UI-05 Home motion on scroll** · draft (SRC-013, CR-012, ADR-019) — The home page reveals its sections as they first come into view, with Framer Motion only.
> - Given a visitor scrolls the home page, When a section first enters the viewport, Then it fades in and rises 16–24 px once, in 450 ms, and does not animate again on that page view.
> - Given a group (category tiles, rail cards, steps, facts), Then its children stagger 60–80 ms and the whole group settles within about 600 ms.
> - Given the hero, Then it is never hidden or revealed on scroll (the LCP image is never behind an animation).
> - Given `prefers-reduced-motion: reduce`, Then every section renders in its final state with no transform, no fade and no transition.
> - Given JavaScript is disabled, Then the full page content is visible.
> - Given Arabic (RTL), Then no reveal moves content horizontally, and the champagne hairlines draw from the inline start edge.
> - LCP is unchanged and CLS stays within the CR-009 budget (mobile LCP ≤ 1505 ms en / 1580 ms ar, desktop ≤ 400 ms, CLS ≤ 0.042 mobile / 0.01 desktop).
> - Scope is the home page; other pages keep UI-04 motion.

### 4.4 `web/CLAUDE.md` — rule 5

| | |
|---|---|
| Now | "Motion: Framer Motion for components, GSAP only for the one home-page arch moment (ADR-015), no scroll reveals; always respect `prefers-reduced-motion`." |
| Proposed | "Motion: Framer Motion only — for components, and for the home page's once-only scroll reveals through `components/motion/reveal.tsx` (ADR-019). No GSAP, ScrollTrigger or AOS; no reveal on the hero or outside the home page; always respect `prefers-reduced-motion`." |

(The ADR-015 arch moment is already gone — ADR-018 §8 removed the arch and T-094 deleted the component — so rule 5 is stale on that point today.)

### 4.5 `web/src/test/home-redesign-ui-01.test.tsx` — the UI-01 gate, narrowed not weakened

The test at line 483 is the thing that currently blocks this CR. Change, exactly:

- Keep the four `existsSync` assertions (`aos-init.tsx`, `home-reveals.tsx`, `contact-strip.tsx`, `app/[locale]/template.tsx` stay deleted).
- Keep the forbidden regex, minus one token: `from "aos"`, `data-aos`, `animate-marquee`, `.shimmer`, `pattern-emerald`, `gsap/ScrollTrigger`, `ContactStrip` all stay forbidden. **Only `data-reveal` is removed**, and the test name changes from "no AOS, scroll reveals, page transition, …" to "no AOS, GSAP ScrollTrigger, page transition, marquee, shimmer or contact strip".
- Add in its place, so the surface is not left unguarded:
  - every `whileInView` / `useInView` in `src/` appears only in `components/motion/reveal.tsx`;
  - `components/home/hero.tsx` imports no reveal;
  - `reveal.tsx` references `useReducedMotion`;
  - the existing `gsapMock` assertions (no GSAP call, no timeline) stay.
- Nothing is deleted from the other suites. `home-spacing.test.ts`, `home-adm-06-07.test.tsx` and `prod-01-card.test.tsx` need the `IntersectionObserver` stub from section 5, not a rewrite.

### 4.6 Not changed

- **`04-architecture/api-spec.yaml` — no change.** This CR is presentation only: no endpoint, field, parameter or response shape moves.
- **`04-architecture/data-model.md` — no change.** No model, index or stored field is touched; the reveal is not configurable from the admin (not asked for; raised as a non-goal here so nobody adds a setting later without a CR).
- **`messages/en.json` / `messages/ar.json` — no change.** No new user-facing string, so `npm run i18n:check` is unaffected.
- **`package.json` — no change.** `framer-motion@^12.4.0` is already a dependency and already shipped on the home page by `shelf.tsx` and `product-card.tsx`.
- ADR-014, ADR-015 and ADR-018 get a one-line "amended by ADR-019 on home-page scroll motion" note each; their decisions are not rewritten.

## 5. Tasks (next free after T-111)

| ID | File | Task | Req | Depends |
|---|---|---|---|---|
| T-112 | web | Motion foundation: `components/motion/reveal.tsx` (`Reveal`, `RevealGroup`, `RevealItem`), reduced-motion branch, `<noscript>` fallback, `IntersectionObserver` stub in the test setup; apply the four document edits from section 4.1–4.4 and the gate change from 4.5 | UI-01, UI-05 | — |
| T-113 | web | Home reveals part 1: category bento, shelf (incl. tab crossfade), shop the look | UI-05 | T-112 |
| T-114 | web | Home reveals part 2: `SectionShell` + optional admin sections, how pre-owned works, trust strip, champagne hairline draw (RTL origin) | UI-05 | T-112 |
| T-115 | web | Verification: Vitest en + ar for each section (animated, reduced-motion, RTL), Playwright `e2e/home-motion.spec.ts` (reveal happens, plays once, reduced-motion emulation static, no-JS content present), LCP/CLS re-measured against the CR-009 budget, screenshots 390/768/1440/1920 in `/en` and `/ar` into `03-design/screens-v8/` | UI-05, UI-02 | T-113, T-114 |

One commit per task, on `feat/home-motion`, no push. Task entries are added to `05-delivery/tasks/web.md` after confirmation, then `node scripts/traceability.mjs` runs (UI-05 must resolve to T-112..T-115, no `⚠ NO TASK`), then the changelog entry.

## 6. Risks

| | Risk | Handling |
|---|---|---|
| R-1 | A reveal on the hero or near it delays LCP. | The hero is excluded by decision; the gate test asserts `hero.tsx` imports no reveal; LCP re-measured in T-115. |
| R-2 | jsdom has no `IntersectionObserver`, so existing home tests break or silently assert a hidden DOM. | Children always stay in the DOM; the stub reports "in view" immediately; T-112 lands the stub with the primitive. |
| R-3 | Content invisible with JavaScript off, hurting crawlers. | `<noscript>` forces the final state (Q-6 confirms the approach). |
| R-4 | Shop-the-look hotspots drift if the photo box is transformed. | No scale on that photo; T-085's `e2e/look-alignment.spec.ts` re-run in T-115. |
| R-5 | It slides back to the v1 "reveal on everything" look. | Grammar is constants inside one file, callers cannot pass duration or distance; per-section list in section 2 is the whole allowance. |
| R-6 | Three motion decisions already reversed; a future reader follows a stale one. | Cross-notes in ADR-014, ADR-015, ADR-018; the history table in the client notes. |

## 7. Questions for the owner

| # | Question | Proposal if you have no preference |
|---|---|---|
| Q-1 | Should the hero animate on load again (headline rising as the slide settles), or stay exactly as it is? | Stay as it is. It is the LCP element and already moves (crossfade + zoom). |
| Q-2 | When you scroll back up, should sections animate again, or stay settled? | Stay settled (`once: true`). Replaying on every pass is the v1 feeling you rejected. |
| Q-3 | How strong should the movement be — barely there (16 px), as planned (24 px), or obvious (40 px+)? | 24 px with a 450 ms ease-out. 40 px+ starts to feel like a template. |
| Q-4 | "And others": is the hairline draw plus the shelf tab crossfade enough, or do you also want number/price counters, a marquee or a page transition? | Hairline + tab crossfade only. Counters and marquees were explicitly removed in v2. |
| Q-5 | Should this roll out to shop, product and the other pages later, or stay a home-page signature? | Decide after you see the home page; a follow-up CR, not this one. |
| Q-6 | With JavaScript disabled the content must still be visible — confirm the `<noscript>` fallback is acceptable (it means a tiny inline style block in the HTML). | Yes, keep it. |
| Q-7 | May the CLS/LCP budget from CR-009 move at all for this? | No. Transform and opacity do not shift layout, so the budget should hold unchanged; T-115 proves it. |

## 8. Owner decisions (2026-11-25, plan approved)

| # | Decision |
|---|---|
| Q-1 | Hero stays exactly as it is — no load animation added (as proposed). |
| Q-2 | **Reveals play once.** They do not replay when scrolling back up (`once: true`). |
| Q-3 | **24 px** of vertical movement, 450 ms ease-out. |
| Q-4 | "And others" is the champagne hairline draw plus the shelf tab crossfade only — no counters, no marquee, no page transition (as proposed). |
| Q-5 | No rollout to shop, product or other pages in this CR; a later CR decides, after the owner sees the home page (as proposed). |
| Q-6 | The `<noscript>` final-state fallback is kept, so the page is complete with JavaScript disabled (as proposed). |
| Q-7 | The CR-009 LCP/CLS budget does not move; T-115 proves it holds (as proposed). |

Also instructed: **do not merge into `main` and do not deploy without the owner's approval.** Work stays on `feat/home-motion`, one commit per task, nothing pushed.
