# CR-009 plan: Home page redesign v4

Source: `SRC-010` (owner brief, 2026-11-24; see `01-discovery/client-notes-2026-11-24.md`, addendum 3). Branch: `redesign/home-v4`, created from `autopilot/2026-11-24`. Design record: `ADR-016`. Status: **approved 2026-11-24 (ADR-016 Accepted), with the decisions in section 10. Building on `redesign/home-v4`.** Scope: the home page only. Tokens, fonts, header, footer and every other page stay as CR-008 left them (the arch stays on the auth pages).

## 1. What changes, in one paragraph

The home page becomes a photo-first page in the style of today's leading furniture sites: a one-line announcement bar, two full-height photo panels side by side ("New furniture" and "Pre-owned, for less"), room tiles, a product rail with tabs, one "Shop the look" photo with hotspots, an emerald band that explains pre-owned in three steps, a pre-owned rail and a strip of true facts. The arch is removed from the home page. The one idea that is ours is the split hero: Furnixa sells both new and pre-owned furniture, and the first thing a visitor sees is that choice.

## 2. Baseline (measured before any change)

Harness: production build of commit `40b6800` served by `next start`, Chromium via Playwright, median of 5 runs, home page. Mobile = 390x844, 2x DPR, 4x CPU slowdown, 1.6 Mbit/s down, 150 ms latency (a Lighthouse-like slow 4G). Desktop = 1440x900, no throttling. LCP and CLS are read from `PerformanceObserver` (`largest-contentful-paint`, `layout-shift` without recent input) after 3.5 s. The backend and the demo database were running locally; images come from the real CDN.

| Page | LCP | CLS | Transfer |
|---|---|---|---|
| `/en`, 390 | 1368 ms | 0.0351 | 706 KB |
| `/ar`, 390 | 1436 ms (a second run measured 1076 ms) | 0.0417 | 852 KB |
| `/en`, 1440 | 176 ms | 0.0049 | 794 KB |
| `/ar`, 1440 | 208 ms | 0.0082 | 941 KB |

Run-to-run noise on mobile is about ±200 ms. **Budget (after must not be worse than now):** mobile LCP median at most 10 % above the baseline of the same locale (en ≤ 1505 ms, ar ≤ 1580 ms), desktop LCP ≤ 400 ms, CLS ≤ 0.042 on mobile and ≤ 0.01 on desktop, transfer at most 15 % above the baseline. I will re-measure with the same script (committed as `web/scripts/vitals.mjs`) and publish both tables in the task note. Lighthouse itself is not installed and adding it is a new dependency, so the harness above is the measurement.

## 3. Sections, in order (desktop 1440 and mobile 390 wireframes)

```
 1. ANNOUNCEMENT BAR   36 px, emerald, white 13 px text, centred, one line, not sticky
 +--------------------------------------------------------------------------------+
 |                        Cash on delivery across Saudi Arabia                     |
 +--------------------------------------------------------------------------------+
    [existing slim header: wordmark, search, favourites, account, cart]

 2. SPLIT HERO   two photo panels, height = 100svh - header - bar (min 560, max 900)
 +-------------------------------------+------------------------------------------+
 |                                     |                                          |
 |   lifestyle photo: living room      |   lifestyle photo: warm room, armchair    |
 |                                     |                                          |
 |   ~~~~~~~~ soft bottom scrim ~~~~~~ |   ~~~~~~~~~ soft bottom scrim ~~~~~~~~~  |
 |   New furniture                     |   Pre-owned, for less                    |
 |   Sofas, beds and tables, delivered |   Pieces with a clear condition grade,   |
 |   to your door.                     |   photographed and described.            |
 |   [ Shop new ]                      |   [ Shop pre-owned ]                     |
 +-------------------------------------+------------------------------------------+
 | admin promo strip (only if a banner is active): "Title  subtitle   Link text"    |   56 px, sand
 +--------------------------------------------------------------------------------+

 3. SHOP BY ROOM   tiles 4:5, 12 px radius, name under the image, snap scroll
 Shop by room                                                          See all
 [img] [img] [img] [img] [img]       5 tiles from the admin's CATEGORY_GRID
 Living  Armchairs Dining Beds  Office

 4. RAIL WITH TABS   [ New arrivals | Featured ]                       See all new
 [sand tile] [sand tile] [sand tile] [sand tile]   -> scroll-snap rail, arrows on desktop
  name        name        name        name
  SAR 9,800   ...         chip: Pre-owned, good (pre-owned only)

 5. SHOP THE LOOK   one wide room photo, 3-4 hotspot dots, one popover at a time
 +--------------------------------------------------------------------------------+
 |  Shop the look                                                                  |
 |  Tap the dots to see what is in the room.                                       |
 |  +----------------------------------------------------------------------+      |
 |  |                  (o)                                                 |      |
 |  |         (o)               +-----------------+                        |      |
 |  |                           | [img] Name      |   popover card:        |      |
 |  |                    (o)    | SAR 9,800       |   image, name, price,  |      |
 |  |                           | [Add to cart]   |   add to cart          |      |
 |  +----------------------------------------------------------------------+      |

 6. PRE-OWNED EXPLAINED   full-width emerald band, a real 3-step sequence
 How pre-owned works
 1  We photograph it     2  We grade it       3  You pay when it arrives

 7. PRE-OWNED PICKS RAIL (same card as 4)

 8. TRUST STRIP   three plain facts, hairline above and below, no icons larger than 20 px
 Pay in cash when it arrives  |  We deliver to Riyadh, Jeddah, Mecca, Medina, Dammam, Khobar  |  (Free delivery over SAR X, only if set)

 9. FOOTER  unchanged
```

Mobile 390: the announcement bar wraps to at most two lines (kept short); the split hero stacks, "New furniture" first, each panel 70svh (min 420) so the second panel's top peeks; room tiles and the rails scroll horizontally with a visible peek of the next item; the look photo is full width and the popover opens as a card pinned to the bottom edge of the photo; the band's steps stack; the trust strip stacks.

### Section rules

1. **Announcement bar.** Static message from the message files (not admin editable, as requested). Server-rendered, fixed height, so it adds no layout shift.
2. **Split hero.** Two `next/image` panels. Panel 1 has `priority` (it is the LCP image on mobile and on desktop); panel 2 loads normally (it is in the viewport on desktop, below the fold on mobile). `sizes="(min-width: 1024px) 50vw, 100vw"`, fixed container heights so nothing shifts. The photos are two lifestyle photos from the demo manifest (`backend/scripts/demo-data/images.json`, Pexels licence, photographer and page URL recorded) copied into `web/public/home/` and optimised by Next. The exact two are picked in the screenshot critique, candidates: `hero-desktop-1` and `hero-desktop-2` or an armchair room. They are not admin editable (see Q-4). Text sits on a soft bottom scrim made of the `foreground` token at alpha (`from-foreground/80` to transparent), sized so white text clears 4.5:1 even over a white photo. Each panel has one button to its listing: `/shop?type=new` and `/shop?type=resale`. **The GSAP load moment:** both panels settle once on load (image scale 1.06 to 1 over 900 ms, text rises 16 px with a 120 ms stagger, panel 2 starts 150 ms after panel 1). Only `transform` is animated and no element starts at opacity 0, so the LCP image is painted at full opacity from the first frame. Under `prefers-reduced-motion` nothing animates. The load moment is the only GSAP use on the page.
3. **Admin banner as a promo strip.** If at least one banner is active, the first one by sort order renders as a slim sand strip under the split hero: its localized title, subtitle (hidden below 640 px) and CTA label as a text link (only if `ctaHref` passes `safeHref`). The banner images and the hero rotation (CR-008 Q-6) are no longer used on the home page. With no active banner the strip is absent.
4. **Shop by room.** Tiles come from the admin's `CATEGORY_GRID` section (top five categories, the admin order), image 4:5, radius 12 px (one new token, `--radius-tile`), the category name under the image in Readex 500. Categories without an image show the flat sand placeholder with the wordmark. Horizontal scroll-snap on every width, the first tile aligned to the container edge, arrow buttons from md up. The brief names Living room, Bedroom, Dining, Office and Outdoor; the demo categories are Living Room Sofas, Armchairs, Dining Tables, Dining Chairs, Beds, Wardrobes, Office Desks and Decor & Lighting, and there is no Outdoor category (see Q-3).
5. **Rail with tabs.** Two tabs (`role="tablist"`, arrow keys): New arrivals (the `NEW_ARRIVALS` section data, falling back to the newest products) and Featured (the `FEATURED_PRODUCTS` section data, which are products the admin flagged or picked). Not "Best sellers": the API has no sales ranking and a "best seller" label would be an invented claim (see Q-2). The card is the CR-008 tile unchanged: square sand backdrop with the photo multiplied, second image on hover from md up, heart, quick add (always visible on mobile, on hover or focus on desktop), name, price in SAR, condition chip (pre-owned only), no border, no shadow. Eight products per tab, scroll-snap, four visible on desktop and 2.3 on mobile.
6. **Shop the look.** New optional admin data, see section 4. Hotspots are real `<button>`s positioned in percent over the photo; the focus ring is visible; Enter, Space and tap toggle a popover (`aria-expanded`, `aria-controls`); Escape closes it and returns focus; one popover is open at a time; the popover flips so it never leaves the photo. The popover is a small product card: image, name, price in SAR, "Add to cart" (the existing cart store, fly dot and toast). The photo has `loading="lazy"` and fixed aspect ratio 16:9 (4:5 on mobile via `aspect-` classes), so no shift. With no look configured the section is not rendered.
7. **Pre-owned explained.** Full-width emerald band, three steps with large numerals (a real sequence). New copy in section 5, no inspection claims (B-036), no "how we check" wording.
8. **Pre-owned picks rail.** The `RESALE_PICKS` section data (fallback: newest pre-owned), same card, title from the admin section else the message default.
9. **Trust strip.** Only facts the data supports: cash on delivery (a product rule), the active delivery cities from Site Settings (names, localized), and, only when `freeDeliveryThreshold` is set, "Free delivery over {amount}". No reviews, ratings, warranty, returns or "authentic" wording.
10. **Footer.** Unchanged.

Admin-hidden sections (Promo banner, Testimonials) keep working: if an admin turns one on it renders after the pre-owned rail in the same quiet style (CR-008 Q-1 stays valid). `FEATURED_PRODUCTS` feeds the second tab instead of a section of its own.

## 4. Backend and data (the only non-web change)

"Shop the look" needs data that does not exist. Cheapest honest option: **one new home section type `SHOP_THE_LOOK`** (the home sections already carry free JSON `config`, are resolved server-side by `GET /cms/home` and are visible/hidden/ordered by the admin).

- `SectionType` enum (Prisma) and the zod enum gain `SHOP_THE_LOOK` (additive, no field removed or renamed).
- `config.look = { image: ImageAsset, hotspots: [{ x: 0..100, y: 0..100, productId }] }`, 1 to 4 hotspots, `image` validated like banner images (R2 key under this deployment's scope, localized alt text required in en and ar).
- `GET /cms/home` resolves each hotspot to its PUBLISHED product (same product shape as the other sections); a hotspot whose product is unpublished or deleted is dropped; a look with no hotspot left, or no image, is omitted.
- `sectionHasContent` (web) learns the new type.
- **Seeding:** the demo seed creates one look section (a living-room photo with 3 hotspots on seeded products). I will **not** run `demo:reset` or any data command; the owner runs it after the seed commit.
- **Admin editing is a follow-up task, not built now:** an editor needs image upload, a click-to-place point picker and a product picker. Until then the look exists only through the seed or the API. This is not cheap, so it is listed as a follow-up as the brief allows.
- Spec first: `api-spec.yaml` (`HomeSection` type enum, `look` config schema, resolved `look` payload on `/cms/home`) and `data-model.md` (`HomeSection.type` enum, config shape). Proposed text is in section 7.

## 5. Copy (new copy for approval, en and ar; nothing else is new)

Existing approved copy reused unchanged: "Shop new" / تسوّق الجديد, "Shop pre-owned" / تسوّق المستعمل, "How pre-owned works" / كيف يعمل الأثاث المستعمل, "View all" / عرض الكل, "Add to cart", the grade wording and the COD footer sentence.

| Where | English | Arabic |
|---|---|---|
| Announcement bar (owner decision: N is the number of active delivery cities, computed, never hardcoded; hidden when there are none) | Cash on delivery in {count, plural, one {# Saudi city} other {# Saudi cities}} | الدفع عند الاستلام في {count, plural, one {مدينة سعودية واحدة} two {مدينتين سعوديتين} few {# مدن سعودية} many {# مدينة سعودية} other {# مدينة سعودية}} |
| Hero panel 1 title | New furniture | أثاث جديد |
| Hero panel 1 line | Sofas, beds and tables, delivered to your door. | كنب وأسرّة وطاولات، تصلك إلى باب بيتك. |
| Hero panel 2 title (owner decision) | Pre-owned, for less | مستعمل بسعر أقل |
| Hero panel 2 line | Pieces with a clear condition grade, photographed and described. | قطع بدرجة حالة واضحة، مع صور ووصف لكل قطعة. |
| Hero photo alt (decorative, short) | A bright living room with a sofa / A warm room with an armchair | غرفة معيشة مضيئة وفيها كنبة / غرفة دافئة وفيها كرسي بذراعين |
| Rooms section title | Shop by room | تسوّق حسب الغرفة |
| Rail tabs (no "best seller" anywhere) | New arrivals / Featured | وصل حديثاً / مختارات |
| Rail "see all" | See all new / See all featured | عرض كل الجديد / عرض كل المختارات |
| Look title | Shop the look | تسوّق هذا التنسيق |
| Look hint | Tap the dots to see what is in the room. | اضغط على النقاط لترى ما في الغرفة. |
| Hotspot button (accessible name) | Show {name} | اعرض {name} |
| Pre-owned step 1 | We photograph it. Every piece gets its own photos. | نصوّرها. لكل قطعة صورها الخاصة. |
| Pre-owned step 2 | We grade it. Each piece is marked new, like new, good or fair, with notes. | نصنّفها. تحمل كل قطعة درجة حالة: جديد أو كالجديد أو جيد أو مقبول، مع ملاحظات. |
| Pre-owned step 3 | You pay when it arrives. Order online and pay in cash on delivery. | تدفع عند وصولها. اطلب عبر الموقع وادفع نقدًا عند الاستلام. |
| Pre-owned picks title (fallback) | Pre-owned picks | مختارات من المستعمل |
| Trust 1 | Pay in cash when it arrives | ادفع نقدًا عند الوصول |
| Trust 2 | We deliver to {cities} | نوصّل إلى {cities} |
| Trust 3 (only if set) | Free delivery over {amount} | توصيل مجاني للطلبات فوق {amount} |

Two notes on existing copy. The current step 3 says "Pay at checkout and we deliver the piece", which contradicts cash on delivery; the new step 3 fixes that. "Half the price" and "across Saudi Arabia" are the owner's phrases and are claims, see Q-1 and Q-5. The "we photograph it" step says only what is true for every piece (it has photos), nothing about inspection (B-036).

## 6. Contrast, performance and accessibility gates

- **No new dependency.** Hand-built tabs, popover and rails (the repo already hand-builds dialogs); GSAP and Framer Motion are already installed.
- **AA tests (every new surface, light):** white on the announcement bar (emerald), split-hero text over the scrim computed worst-case on a white photo (the scrim alpha is read from the class, e.g. `from-foreground/80`), the promo strip (ink on sand), active and inactive tab labels, the "See all" links, hotspot ring (ink 2 px ring on a white 28 px dot, graphic 3:1 against the dot, and the dot against sand and white), popover text on paper, the emerald band (white and sand text on emerald), trust strip text (stone ink on paper). The existing call-site scan in `ui-02-aa-call-sites.test.ts` already covers every class string; the new surfaces add explicit worst-case tests for text over photos.
- **Images:** `next/image` everywhere, `sizes` per layout, `priority` only on the first hero panel, `loading="lazy"` for everything below the fold, fixed aspect ratios.
- **Motion:** one GSAP timeline on load; Framer Motion only for user actions (heart, add to cart, popover open, tab switch is not animated). Reduced motion: no GSAP, no auto movement.
- **RTL:** logical utilities only; the panels keep their order in both directions (New first, on the start side); rails start at the inline start; chevrons rotate; the scrim, text alignment and popover flip correctly.
- **e2e:** home renders in `/en` and `/ar` at 390 and 1440 without horizontal overflow, the hero images load, the tabs switch by keyboard, a hotspot opens and closes by keyboard (when a look is seeded), reduced motion renders everything static.

## 7. Proposed edits to the documents (applied only after approval)

- **`03-design/design-system.md`:** section 4 "The arch": the home page no longer uses it (hero and category tiles now use photo panels and 12 px radius tiles); the arch stays on the auth pages. Section 3: add `--radius-tile` 12 px for room tiles and the look photo; section 5 components: announcement bar, split hero, promo strip, tabs, rail, hotspot, look popover, trust strip; section 6 wireframe: replace the home wireframe with the one above; section 7 motion: the one orchestrated moment is now the split-hero settle (transform only).
- **`02-product/PRD.md`:** `CAT-01`, `ADM-06` and `ADM-07` get the new home composition (hero from two fixed photos, admin banner as a strip, `SHOP_THE_LOOK` as a hideable, orderable section). New requirement `ADM-15 Shop the look section` · draft: the admin can show a room photo with 1 to 4 product hotspots (editing UI is a follow-up; until then through the API and the seed). Acceptance: a hotspot whose product is unpublished is not shown; a look without a photo or hotspots is hidden; keyboard and touch can open a hotspot's product card.
- **`04-architecture/api-spec.yaml`:** `SectionType` enum gains `SHOP_THE_LOOK`; `SectionConfig.look` (image, hotspots[1..4] with x, y in 0..100 and productId); `GET /cms/home` section payload gains `look: { image, hotspots: [{ x, y, product }] }` for that type.
- **`04-architecture/data-model.md`:** `HomeSection.type` enum, `config` shape for `SHOP_THE_LOOK`, validation rules.
- **`ADR-015`:** a note that the arch no longer applies to the home page (applied now, marked as taking effect on approval).

## 8. Tasks (IDs provisional, next free after T-079)

| ID | Task | Depends | Req |
|---|---|---|---|
| backend T-080 | `SHOP_THE_LOOK` section: enum, zod config, resolver, tests, api-spec and data-model, demo seed entry (no data command run) | approval | ADM-15, ADM-07 |
| web T-081 | Announcement bar, split hero with the GSAP settle, admin banner promo strip, remove the arch from the home page, `web/scripts/vitals.mjs` | approval | CAT-01, ADM-06, UI-01 |
| web T-082 | Shop by room tiles, rail with tabs (New arrivals / Featured), pre-owned picks rail | T-081 | CAT-01, ADM-07, PROD-01 |
| web T-083 | Shop the look (hotspots, popover, keyboard and touch) | T-080, T-082 | ADM-15 |
| web T-084 | Pre-owned explained band, trust strip, assembly, vitals before and after, screenshots in `03-design/screens-v4/` | T-081..T-083 | CAT-01, UI-01, UI-02 |
| admin T-085 (follow-up, not in this scope) | Look editor: photo upload, point picker, product picker | T-080 | ADM-15 |

Each task: plan, tests in en and ar, typecheck, lint, i18n, build, e2e, AA gate, `/review-task`, one commit on `redesign/home-v4`. After T-084 I stop and show the home page (screenshots at 390 and 1440, `/ar` and `/en`, plus tab, hover and hotspot states). Other pages are not touched. Not pushed. No `demo:reset` or other data command is run.

**Screenshot data dependency (needs your choice, Q-6).** The look and the new seed copy only appear on screen after the demo database is re-seeded. Either you run `demo:reset` after the T-080 seed commit, or you allow me one additive `POST /admin/home-sections` (creates the look section, deletes nothing). Without one of them, the look states cannot be captured.

## 9. Questions for the owner

| # | Question | Proposed answer |
|---|---|---|
| Q-1 | "Pre-owned, for less" is a pricing claim. Is it true for the catalogue, or should it say "lower prices" or "up to half the price"? | Keep your words if you stand behind them; otherwise "Pre-owned, lower prices" / "مستعمل بأسعار أقل" |
| Q-2 | Tabs "Best sellers / New arrivals": the API has no sales ranking. | Use "New arrivals / Featured" (admin-chosen). If you want true best sellers, a later task counts delivered order lines per product and adds a `BEST_SELLERS` source |
| Q-3 | Rooms: the brief lists Living room, Bedroom, Dining, Office, Outdoor; the catalogue has product-type categories and no Outdoor. | The tiles are the admin's first five categories (names as the admin wrote them). To get exactly your five, the admin creates or renames categories and picks them in the Category grid section |
| Q-4 | The two hero photos are static files in `web/public/home/` (not admin editable). | Accept for now; admin-editable hero photos become a follow-up in Site Settings |
| Q-5 | "Cash on delivery across Saudi Arabia": the active cities today are Riyadh, Jeddah, Mecca, Medina, Dammam and Khobar. | Keep your line in the bar, but the trust strip lists the actual cities. If you prefer a strictly true bar: "Cash on delivery in 6 Saudi cities" (the number comes from settings) |
| Q-6 | How to get the look into the dev database for screenshots. | You run `demo:reset` after the seed commit, or you approve one additive `POST /admin/home-sections` |
| Q-7 | The look is built backend-first (a new section type). Is a follow-up admin editor acceptable? | Yes, as T-085 |

## 10. Owner decisions (2026-11-24)

1. Panel 2 reads "Pre-owned, for less" (ar «مستعمل بسعر أقل»). "Half the price" is not used; the stronger claim is recorded as owner question **B-037** (open).
2. Rail tabs: "New arrivals / Featured"; no "best seller" label anywhere.
3. Room tiles are the admin's first five categories by sort order.
4. Static hero photos are accepted; follow-up **T-089** makes them admin-editable (Site Settings fields, admin upload).
5. Announcement bar: "Cash on delivery in N Saudi cities" with N computed from the active delivery cities (6 today), never hardcoded; the bar is hidden if no city is active. The trust strip lists the real cities.
6. No admin write endpoint is called. **The `SHOP_THE_LOOK` seed change (T-080) is committed first, then I stop and tell the owner; the owner runs `demo:reset`; then the web tasks and screenshots continue.**
7. Follow-up **T-085** (admin editor for the look) is agreed.
8. Step 3 copy fix and the GSAP approach are approved as planned.

Task order now: T-080 (backend, seed) → STOP → owner runs `demo:reset` → T-081, T-082, T-083, T-084 → stop after the home page with screenshots and the before/after LCP and CLS tables. Follow-ups, not built here: T-085 (look editor), T-089 (hero photos in Site Settings).
