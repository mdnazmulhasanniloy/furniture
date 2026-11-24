# ADR-016: Home v4, a photo-first page with a split New / Pre-owned hero

Status: **Accepted 2026-11-24** (CR-009, SRC-010; owner approved the plan and answered Q-1 to Q-7) · Source: CAT-01, ADM-06, ADM-07, UI-01, UI-02, new ADM-15 · **Supersedes the home composition of ADR-015** (arched hero, arch category row, one segmented shelf). **Unchanged:** CR-008 tokens, fonts, header, footer and every other page; the AA contrast gate; the rule that the app never claims inspection (B-036); the arch on the auth pages.

## Context

The owner found the CR-008 home page not professional enough and asked for the look of today's leading furniture e-commerce sites: photo-first, generous white space, large lifestyle photography, a calm interface. The one idea that is Furnixa's own is that it sells new and pre-owned furniture, so that choice becomes the hero. The arch, which carried the CR-008 identity, comes off the home page.

## Decision (proposed)

1. **Composition, in order:** announcement bar, split hero (New furniture | Pre-owned, for less), optional admin banner as a slim promo strip, shop by room, rail with tabs (New arrivals / Featured), shop the look, emerald "How pre-owned works" band, pre-owned picks rail, trust strip, footer.
2. **No arch on the home page.** `Arch` stays for the auth pages only.
3. **Photography:** two lifestyle photos as static files (`web/public/home/`), not admin editable for now; text sits on a soft scrim built from the `foreground` token at alpha, sized for 4.5:1 over a white photo.
4. **Motion:** one GSAP load moment (the two panels settle: scale 1.06 to 1, text rises 16 px, staggered). Transform only, nothing starts at opacity 0, nothing moves under reduced motion. Everything else answers a user action (Framer Motion) or does not move.
5. **Data:** the page reuses the existing home sections (`CATEGORY_GRID`, `NEW_ARRIVALS`, `FEATURED_PRODUCTS`, `RESALE_PICKS`, `PROMO_BANNER`). One new section type, `SHOP_THE_LOOK` (an image plus 1 to 4 hotspots, each a product), is the only backend change; its admin editor is a follow-up.
6. **No invented claims.** "Best sellers" is replaced by "Featured" (no sales ranking exists); the trust strip lists only cash on delivery, the active delivery cities and, if set, the free-delivery threshold.
7. **Performance budget as a rule:** mobile LCP and CLS must not exceed the baseline measured before the change (CR-009 plan section 2); `priority` only on the first hero panel; fixed aspect ratios and heights for every image block.
8. **No new dependency.** Tabs, rails and the hotspot popover are hand-built like the existing dialogs.

## Consequences

- `home-sections.tsx`, `hero.tsx`, `category-row.tsx` and `shelf.tsx` are replaced; the product tile (CR-008) is reused unchanged in the rails.
- Backend gains `SHOP_THE_LOOK` (Prisma enum value, zod enum and config, `GET /cms/home` resolver). Additive; no field is removed or renamed.
- The hero's admin banner images and rotation stop being used on the home page. Banners still exist and now appear as a strip; the admin banner editor is unchanged.
- The two hero photos are code-managed until a Site Settings field exists (follow-up).
- Tests that encode the CR-008 home (arched hero, arch tiles, segmented shelf, hero rotation) are replaced by tests for v4; they describe removed features and are not weakened.
- Risk: two large photos above the fold can raise mobile LCP. Mitigation: one `priority` image, `sizes` per layout, optimised sources, and the budget above, measured before and after with the same script.

## Alternatives considered

- Keep the arch hero and only add sections: rejected by the owner.
- Make the hero photos admin banners: rejected, the brief wants the banner to become a strip so the New / Pre-owned choice stays fixed.
- A carousel hero: rejected, it hides one of the two sides of the business.
- Add Lighthouse for measurement: rejected (new dependency); a Playwright and `PerformanceObserver` harness gives LCP and CLS with no dependency.

## Owner decisions (2026-11-24)

- The second panel says "Pre-owned, for less" (ar: «مستعمل بسعر أقل»), not "half the price". The stronger claim stays an open owner question (B-037).
- Rail tabs are "New arrivals / Featured"; the word "best seller" appears nowhere.
- Room tiles are the admin's first five categories by sort order.
- The two hero photos are static for now; making them admin-editable is a follow-up (T-089).
- The announcement bar says "Cash on delivery in N Saudi cities", where N is computed from the active delivery cities in Site Settings, never hardcoded; the trust strip lists the real cities.
- No admin write endpoint is called to get demo data. The `SHOP_THE_LOOK` seed change is committed first; the owner runs `demo:reset` and then the screenshots continue.
- The look's admin editor is the follow-up T-085.
- Step 3 of "How pre-owned works" says cash on delivery (the old "Pay at checkout" is fixed).
- The GSAP approach (transform only, nothing at opacity 0) is approved.

> **Note 2026-11-24 (CR-011, ADR-018, proposed):** the owner rejected this direction. The split hero, announcement bar and CR-009 web tasks T-081 to T-084 are cancelled before any web code was written. Only the backend `SHOP_THE_LOOK` section (T-080, commit 9f0f879) is kept.
