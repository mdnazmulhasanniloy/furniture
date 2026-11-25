# Client Notes — 2026-11-25

Source: owner brief, given in chat on branch `fix/per-app-refresh-cookie` after looking at the running storefront. Ref ID: `SRC-013` (change request **CR-012**).
Status: **confirmed by the owner 2026-11-25.** The plan (`05-delivery/cr-012-plan.md`) and `04-architecture/adr/ADR-019-home-scroll-reveals.md` are approved, with Q-2 (plays once) and Q-3 (24 px) answered and the other five taken as proposed; the PRD, design system and `web/CLAUDE.md` edits are applied, and tasks T-112 to T-115 are open on branch `feat/home-motion`. Not merged to `main` and not deployed without the owner's approval.

## Original (verbatim, as written by the owner)

> website a kono animation dekhte parchi na. tumi fremer motion use kore scrool animation and others sundor dekhe kicu animation add kore daw

English rendering (not the owner's words): "I can't see any animation on the website. Using Framer Motion, add scroll animation and other nice-looking animations."

Scope answered by the owner in the same session, when told that scroll animation contradicts an approved decision:

> - Approach: **change request, docs first** — update `design-system.md` §7, `web/CLAUDE.md` rule 5 and the UI-01 gate test to allow scroll reveals, then build them.
> - Scope: **home page only** (hero, category bento, product shelf, shop the look, how pre-owned works, trust strip).

## Structured statements

| # | Statement | Ref | Touches |
|---|-----------|-----|---------|
| 1 | The storefront reads as static while scrolling; the owner wants visible motion. | SRC-013.1 | design-system §7, UI-01 |
| 2 | Scroll-triggered reveals are wanted, built with **Framer Motion** (not GSAP/ScrollTrigger, not AOS). | SRC-013.2 | design-system §7, ADR-019 |
| 3 | "and others": motion beyond scroll is wanted too, as long as it looks refined. | SRC-013.3 | design-system §7 |
| 4 | Scope is the **home page only**; other pages are untouched by this CR. | SRC-013.4 | cr-012 tasks |
| 5 | Process is docs first: design system, PRD, CLAUDE.md rule 5 and the UI-01 gate test change before any component code. | SRC-013.5 | delivery |

## What this reverses

This is the third motion decision on the same surface, so the history matters:

| Decision | Date | Motion rule |
|---|---|---|
| CR-007 / ADR-014 (SRC-008.6) | 2026-11-24 | GSAP + ScrollTrigger section reveals, AOS on content pages, Framer page transition |
| CR-008 / ADR-015 (SRC-009) | 2026-11-24 | One GSAP load moment, Framer for user actions only, **no generic reveals**, AOS dropped |
| CR-011 / ADR-018 §7 (SRC-012) | 2026-11-24 | Carousel crossfade, slow zoom, hover zoom only; **nothing on scroll**; GSAP leaves the home page |
| **CR-012 / ADR-019 (SRC-013)** | **2026-11-25** | **Framer Motion scroll reveals return, home page only** |

The owner approved the removal in `05-delivery/redesign-v2-plan-review.md` Q-4 ("do you approve dropping AOS, the page transition, the marquee and the scroll reveals") — so ADR-019 amends ADR-018 §7 rather than claiming the earlier removal was a mistake. The reason the reveals were dropped was that v1 put one on every section and the result read as templated; ADR-019 is narrower on purpose (see its Context).

## Not stated (raised as open questions in `05-delivery/cr-012-plan.md` section 7)

Whether the hero itself should animate on load again (Q-1); whether reveals replay when scrolling back up or play once (Q-2); how strong the movement may be (Q-3); whether "and others" extends to the shelf tab switch and number/price counters (Q-4); whether the same system later rolls out to shop and product pages (Q-5); what happens with JavaScript disabled (Q-6); whether the measured LCP/CLS budget from CR-009 may move at all (Q-7).
