# ADR-019: Framer Motion scroll reveals on the home page

Status: **Accepted 2026-11-25** (CR-012, SRC-013; owner approved the plan, answers recorded in `05-delivery/cr-012-plan.md` section 8) · Source: UI-01, UI-05 (new) · **Amends §7 of ADR-018** (which allowed nothing on scroll). Keeps ADR-017 (theme presets) and the rest of ADR-018 untouched.

## Context

ADR-018 §7 limited storefront motion to the carousel crossfade, the slow hero zoom and the tile hover zoom, and removed every scroll animation. That removal was deliberate and owner-approved (`05-delivery/redesign-v2-plan-review.md` Q-4): v1 had put a reveal on **every** section via AOS and GSAP ScrollTrigger, which is exactly what made the site read as templated.

Looking at the running site on 2026-11-25 the owner reported the opposite problem: below the hero the page does not move at all, so it reads as flat. The motion that survives — cart button, favourite heart, OTP boxes, card hover zoom, mega-menu — only answers a click or hover, so a visitor who just scrolls sees none of it.

Both observations are true. The failure in v1 was not that sections appeared on scroll; it was the uniform, long, decorative reveal on everything, plus three animation libraries doing overlapping jobs. So the question this ADR answers is not "reveals or no reveals" but "what is the smallest amount of scroll motion that makes the page feel alive without returning to the v1 look".

## Decision (proposed)

1. **Scroll reveals return, on the home page only**, and only through **Framer Motion** (`whileInView` / `useInView`). GSAP, ScrollTrigger and AOS stay out: no new dependency, and one library owns motion.
2. **The hero never reveals.** It holds the LCP image and already has its own crossfade and zoom (ADR-018 §4). It is excluded, so the LCP element is never hidden behind an animation.
3. **One shared primitive, not per-section code.** New `web/src/components/motion/reveal.tsx` (`"use client"`) exports `<Reveal>` and `<RevealGroup>` / `<RevealItem>`. Server components (`home-sections`, `how-resale`, `trust-strip`, `category-row`) stay server components and wrap their content; only the wrapper ships as client JS.
4. **One restrained grammar, applied uniformly** — this is what keeps it from reading as templated:
   - `opacity` and `transform` only. Never `width`, `height`, `top`, `filter` or layout properties.
   - Movement is `y` only, **24 px** (owner, Q-3), never `x` (so nothing has to mirror in RTL) and never scale on text.
   - 450 ms, ease-out; a group staggers its children 70 ms, compressed towards a **60 ms floor** once the stagger window would pass 350 ms, so a long row does not trickle in. Every value stays inside the approved 60–80 ms band, and an eight-card rail settles within about 900 ms. (Corrected twice during T-112: the draft said "60–80 ms, capped at ~600 ms total", which is arithmetically impossible — an 8-card rail at 70 ms is 490 ms of stagger plus a 450 ms fade. The first fix compressed to 350/(n−1), which fell to 50 ms for eight cards and so left the approved band; the floor is what keeps both promises.)
   - `once: true` — a block animates the first time it is seen and never again, so scrolling back up is quiet (Q-2).
   - Trigger margin `-10%`: the block is already settled by the time it is comfortably in view, so nothing is read mid-fade.
5. **Reduced motion is a real branch, not a shortened duration.** Under `prefers-reduced-motion: reduce` the reveal renders its children in their final state with no initial opacity, no transform and no transition. The existing `useMotionPrefs` hook (`web/src/lib/use-motion-prefs.ts`) is reused — the one hook every animation in the storefront already reads — so neither reduced motion nor direction logic is re-implemented here. Its `dir` is not needed: these components move on `y` only, and the single horizontal thing (`RevealLine`) flips through a logical CSS class, which keeps working with JavaScript off.
6. **"And others" is spent on two things only** (SRC-013.3): the champagne hairlines in "How pre-owned works" and the trust strip draw in (`scaleX` 0→1 from the inline start edge, so the origin flips in RTL), and the shelf's New / Pre-owned tab switch gets a short crossfade. No marquee, no parallax, no counters, no page transition, no reveal on every heading.
7. **The UI-01 gate test is narrowed, not weakened.** `web/src/test/home-redesign-ui-01.test.tsx` keeps forbidding `from "aos"`, `data-aos`, `animate-marquee`, `.shimmer`, `pattern-emerald`, `gsap/ScrollTrigger` and `ContactStrip`, and keeps asserting the four deleted files stay deleted. Only the `data-reveal` token leaves the forbidden list, and new assertions take its place: reveals exist only via the shared primitive, the hero is not wrapped in one, and the primitive has a reduced-motion branch.

## Consequences

- The home page's client bundle grows by the wrapper only; `framer-motion` is already shipped by `product-card`, `shelf`, `site-header` and `cart-button`, so there is no new library cost.
- Content must stay readable with JavaScript disabled. A Framer `initial={{ opacity: 0 }}` is inline in the SSR HTML, so without JS the block would never fade in. Mitigation (Q-6): the primitive renders visible markup and a `<noscript>` style block forces the final state, so no-JS and crawler views show the full page.
- `home-redesign-ui-01.test.tsx`, `home-spacing.test.ts` and the other suites render these sections in jsdom, where `IntersectionObserver` does not exist — so the primitive's own guard (consequence of decision 5) renders them in their final state and **those suites need no change and no stub**. A test that wants the animating path stubs a silent observer in its own file, which is already how `t053-header-footer` and `t056-product-condition` do it; the project has no global Vitest setup file (`environment: "node"` with a per-file jsdom pragma), and T-112 did not add one. Children must stay in the DOM in every branch (opacity, never `display: none`).
- LCP is unaffected (the hero is excluded) but CLS must be re-measured: a 24 px `transform` does not shift layout, so the expectation is no change, and the CR-009 budget is re-run before and after (Q-7).
- This is the fourth motion decision on the same surface. ADR-014, ADR-015 and ADR-018 get a one-line note pointing here, so no future reader takes "nothing on scroll" as current.
- `design-system.md` §7 and `web/CLAUDE.md` rule 5 both said "no scroll reveals"; both were rewritten when this ADR was accepted (2026-11-25), so the written rule and the gate test cannot disagree. The gate test itself changes in T-112, because it is code.
- `web/CLAUDE.md`'s stack line still lists "GSAP (+ScrollTrigger)" and `gsap` / `@gsap/react` are still in `web/package.json`, though no storefront file imports them any more. Removing them is a separate cleanup, not part of this CR.

## Alternatives considered

- **Keep ADR-018 and only strengthen allowed motion** (richer hover, a hero load timeline). Rejected by the owner in this session: it does nothing for a visitor who only scrolls.
- **GSAP + ScrollTrigger**, already a dependency. Rejected: the owner asked for Framer Motion, ADR-018 took GSAP off the home page, and two motion libraries on one page was part of the v1 mess.
- **CSS-only `animation-timeline: view()`**. Tempting (no JS at all), but Safari support is still behind a flag as of this ADR and the fallback would be a second code path.

## Owner decisions (2026-11-25)

Q-2 plays **once**, no replay when scrolling back up; Q-3 **24 px** of vertical movement. Q-1, Q-4, Q-5, Q-6 and Q-7 as proposed: the hero stays exactly as it is (no load animation), "and others" is the hairline draw plus the shelf tab crossfade and nothing more, a rollout to other pages is a later CR, the `<noscript>` fallback is kept, and the CR-009 LCP/CLS budget does not move. Decisions 2 and 4 above therefore stand as written.

Not merged to `main` and not deployed without the owner's approval (owner instruction, 2026-11-25).
