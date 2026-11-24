# ADR-014: "Emerald and gold" token contract, AA contrast gate and motion boundaries

Status: **Accepted 2026-11-24** (CR-007, SRC-008; owner confirmed the proposal and all open questions) · Source: UI-01, UI-02, NFR-03 · Supersedes the colour part of `design-system.md` "Warm Walnut" (ADR-004 is unchanged: shadcn/ui stays the base, daisyUI stays out)

## Context

The owner replaced the walnut palette with "Emerald and gold" on white (SRC-008.1–4) and fixed the motion split between GSAP, Framer Motion and AOS (SRC-008.6). Checking the given values against WCAG 2.1 AA (computed relative luminance, see `cr-007-proposal.md` §3) shows the palette works for text **except** where it is used as text colour in places the brief did not cover: `warning` text (3.64:1 on white), dark-mode `destructive` / `success` text (2.54:1 / 3.14:1 on the dark card), and the gold progress fill on white or muted (2.41:1 / 2.22:1, needs 3:1 as a graphic). Colour usage in the code (`text-warning`, `text-success`, `bg-accent`, about 15 + 6 call sites) therefore cannot be handled by changing token values alone.

## Decision (proposed)

1. **Token contract.** All colour comes from CSS variables in `web/src/app/globals.css` and `admin/src/index.css`. The brief's values become the light (and admin dark) values. Added tokens, because a single colour cannot serve both fill and text roles:
   - `--price` (#86672A light; gold family in dark), used by the shared `Price` component only;
   - `--gold-foreground` (#1C2321, text on gold);
   - `--warning-foreground`, `--success-foreground`, `--destructive-foreground`-style "text shade" tokens for text on tinted badge backgrounds (values in the proposal);
   - `--gold-strong` (#9C7A2E light, owner 2026-11-24): the gold used for meaningful graphics (free-delivery progress fill, 3:1 on white and muted); `--gold` #C8A24A stays decorative only;
   - `--input` (#7D8A85 light, #6B7A75 dark) for form-field borders;
   - dark values for every token an admin screen reads (secondary, destructive, success, warning, ring, input border, gold-foreground).
   `--accent` is removed; its 6 call sites move to `primary` or `gold` by meaning (owner 2026-11-24); amounts use `price`. Components still contain no hex values (existing `ui-01-no-raw-colours` test stays).
2. **AA gate as a test.** One test per app parses the token blocks from the CSS file (not a copy of the values) and asserts, for the light theme (web, admin) and the dark theme (admin): body/muted text on background, card and muted; `Price` on background, card and muted; every `Button` variant's text on its fill; every badge variant's text on its fill. Threshold 4.5:1 for text, 3:1 for graphical objects that carry meaning (progress fill, focus ring, form-field border). A token edit that breaks AA fails CI.
3. **Motion boundaries.** GSAP + ScrollTrigger: home page only (hero, section reveals, pinned "How resale works"), killed on unmount. Framer Motion: product cards, cart drawer, add-to-cart fly + toast, modals, page enter transitions. AOS: content pages (static pages, account headings), `once: true`. Every animation reads one shared reduced-motion hook; GSAP and Framer x-offsets flip sign when `dir="rtl"`. The App Router does not support exit animations for route changes, so page transitions are **enter-only** (fade/slide in).
4. **Performance guard.** G4 (LCP < 2.5 s on 4G) still applies: the hero image is the LCP element (priority, no GSAP dependency before first paint; the zoom starts after load), GSAP/ScrollTrigger are dynamically imported, hover-only effects use `transform`/`opacity`.

## Consequences

- Design-system §1 is rewritten; §4 badges and product card and §5 motion are amended; the web and admin CSS files change token values and gain the new tokens (a small code change beyond "values only", see Decision 1).
- About 21 component call sites change class names (`text-warning`/`text-success` → text-shade tokens, `accent` → `gold`/`price`).
- No new runtime dependency: `framer-motion`, `gsap`, `@gsap/react` and `aos` are already installed in `web` (framer-motion also in `admin`). A toast library (sonner) is approved by the owner and gets installed in web T-051 (add-to-cart and undo toasts).
- The AA test will need a small CSS-variable parser in both apps; it is test code only.

## Alternatives considered

- Keep `warning` as text and accept 3.64:1 — rejected (fails the owner's own AA requirement, SRC-008.5).
- Hand-pick darker values for the whole palette — rejected; the owner's values are kept and only the missing shades are added.
- Re-skin by values only, no new tokens — rejected; it cannot satisfy both the badge-fill and badge-text roles for warning.
