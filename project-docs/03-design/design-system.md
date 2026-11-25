# Design System — "Najdi arch" v2, overridden by "Soft luxury" v3 (ADR-018)

> **Status: accepted 2026-11-24 (ADR-015).** Supersedes the visual parts of ADR-014; its contrast rules stay in force. Build progress is tracked in `05-delivery/cr-008-plan.md`.

Mood: a bright, quiet showroom with one bold gesture, the arch. White page, deep emerald for action, sand behind the furniture, date gold only as a fine line. Works equally in LTR and RTL; Arabic is designed first.


## v3 override: Soft luxury (ADR-018, CR-011, accepted 2026-11-24)

Where this section and the sections below disagree, **this section wins** on the storefront. Sections 1 to 3 remain the base for tokens not named here; section 4 (the arch) is **withdrawn** for the storefront and the component is deleted in T-094.

- **Type:** headings Bodoni Moda (en) and El Messiri (ar), weights 600 and 700 only, via next/font/google, per-locale scoping kept (each locale downloads only its own fonts). Body IBM Plex Sans / IBM Plex Sans Arabic at 17 px (root 106.25 %), line-height 1.65 (ar 1.85). Hero 36 px (mobile) to 72 px (clamp). Bodoni Moda is used from 28 px up (Q-10). Readex Pro is retired.
- **New tokens:** `--blush` #F7EEEA with `--blush-foreground` (soft band surface; ink 15:1, primary and price pass 4.5:1 on it, enforced by the AA gate on the new surface) and `--champagne` #C8A96A (decorative lines and ornaments only; 2.2:1 on paper, the gate rejects any `text-champagne`). `--gold` and `--gold-strong` stay for the free-delivery bar; T-086 folds them, and blush and champagne, into the presets — see section 1b for all five.
- **Layout:** `.container-wide` max 1440 px, gutters 20 / 32 / 48 px; `.band` vertical rhythm 48 px mobile, 72 px desktop; photos may be full-bleed.
- **Shape:** radius sm 4 px, md and lg 8 px, tiles 8 px. No arch.
- **Rails:** `.rail-scroll` hides the native scrollbar and keeps snap; every rail has arrow buttons and keyboard support.
- **Motion:** hero crossfade 700 ms, slow 6 s zoom, tile hover/focus zoom (`.zoom-on-hover`, scale 1.04, 400 ms). Nothing on scroll; GSAP leaves the home page. Reduced motion: no autoplay, no zoom.

## 1. Colour

All colour comes from CSS variables (`web/src/app/globals.css`, `admin/src/index.css`). Components use token classes only.

| Token | Light | Use |
|---|---|---|
| `--background`, `--card` | `#FFFFFF` (paper) | Page, sheets, form fields |
| `--foreground` | `#14201D` (ink) | Text, headings |
| `--muted` / `--secondary` | `#EFE9DD` (sand) | Image backdrops, chips, quiet bands. **Never the page background.** |
| `--muted-foreground` | `#5C6360` (stone ink) | Secondary text on paper and on sand |
| `--stone` | `#6B726F` | Hairlines, icons, placeholders. **Not for text on sand** |
| `--primary` / `--primary-foreground` | `#0F4C45` / `#FFFFFF` | Buttons, links, footer block, "New" chip |
| `--gold` | `#B8913A` (date gold) | Decorative lines and icons only. Never text, never a meaningful graphic |
| `--gold-strong` | `#9C7A2E` | Meaningful gold graphics (free-delivery bar), 3:1 |
| `--price` | `#7A5E22` | Amounts, readable on paper and on sand |
| `--border` | `#E4E0D6` | Decorative dividers |
| `--input`, `--ring` | `#7D8A85`, `#0F4C45` | Field borders (on paper only), focus ring |
| `--destructive`, `--success`, `--success-foreground`, `--warning`, `--warning-foreground` | as ADR-014 | Status |

Contrast (computed, WCAG): ink on paper 16.8, ink on sand 13.9, white on emerald 9.8, emerald on sand 8.1, stone ink `#5C6360` on paper 6.2 / on sand 5.1, price `#7A5E22` on paper 6.1 / on sand 5.0, sand text on emerald 8.1. Date gold on paper is 2.9 and on emerald 3.3: that is why it is a decorative hairline only. Admin dark mode keeps the ADR-014 values. **Admin deviation:** fields can sit on sand panels in the admin, so its `--input` is `#78857F` (3.2:1 on sand, 3.9:1 on paper) instead of `#7D8A85`; the admin gate requires 3:1 on every surface, the web gate requires it on paper only. The admin destructive and blocked chips use a 10 % tint (`bg-destructive/10`, 4.6:1 on sand; 15 % was 4.3:1). The AA tests in `web` and `admin` keep scanning the real CSS and every colour call site.

Dropped from v1: `--secondary` cream `#F6EFD9`, cool grey `#F4F6F5`, `--gold` `#C8A24A`, the old ink `#1C2321`. Fewer neutrals: paper, sand, ink, stone.

## 1b. Themes (CR-010, ADR-017, built in T-086/T-087/T-088)

The table in section 1 is the **Emerald** preset: the default, and the only one written into `globals.css`. An admin
chooses a preset in **Settings → Appearance**; the storefront then receives its token map from `GET /cms/settings` and
sets the variables in the `style` attribute of `<html>` on the server, which overrides `:root`. There is no colour
picker, and the admin dashboard keeps its own colours.

**A theme changes exactly these 14 variables** (`--secondary` always equals `--muted`):

| Token | emerald (default) | walnut | charcoal | sand | burgundy |
|---|---|---|---|---|---|
| `--primary`, `--ring` | `#0F4C45` | `#6B3F2A` | `#2B3236` | `#4D4430` | `#6E1F2E` |
| `--primary-foreground` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `--muted`, `--secondary` | `#EFE9DD` | `#F0E7DC` | `#ECEDEE` | `#E9E0CF` | `#F1E7E2` |
| `--muted-foreground` | `#5C6360` | `#5E5249` | `#54595C` | `#5A5446` | `#5C4D4C` |
| `--stone` | `#6B726F` | `#756A60` | `#6F7479` | `#6E6858` | `#776A68` |
| `--border` | `#E4E0D6` | `#E6DCD0` | `#DFE1E2` | `#DDD3BF` | `#E6DAD4` |
| `--input` | `#7D8A85` | `#85786C` | `#7C8286` | `#80765F` | `#85726F` |
| `--gold` | `#B8913A` | `#C58E4E` | `#A8905A` | `#BCA264` | `#C09A5B` |
| `--gold-strong` | `#9C7A2E` | `#8F5F2A` | `#857037` | `#85702F` | `#8C6A2C` |
| `--price` | `#7A5E22` | `#77491B` | `#5F5226` | `#6E5A22` | `#76471C` |
| `--blush` | `#F7EEEA` | `#F8EFE8` | `#F2F1EF` | `#F6F0E4` | `#FAEFEE` |
| `--champagne` | `#C8A96A` | `#D2A977` | `#BFA878` | `#D0B882` | `#D3A878` |

Arabic names: الزمرد، الجوز، الفحم، الرمل، العنابي.

**A theme never changes** paper (`#FFFFFF`), ink (`#14201D`), `--blush-foreground`, `--gold-foreground`, or any status
colour (destructive, success, warning and their text shades): an order or stock state must read the same in every theme,
and body text stays at 16.8:1. **Every preset is a light theme**; the admin's dark mode is not themed.

**The gate.** A backend test computes the WCAG ratios for every preset with the same relative-luminance formula as
`web/src/test/ui-02-aa-contrast.test.ts`, over three surfaces — paper, `--muted` and `--blush` — and a preset that fails
fails CI. Text needs 4.5:1, graphics (ring, field border, `--gold-strong`, the gold hairline on the footer) 3:1. 135
checks, all passing; tightest are `--gold-strong` on blush 3.51 and the emerald field border on paper 3.59. `--gold` and
`--champagne` are never text, so they are checked only as graphics, plus ink on them for decorative CTAs.

The values live in **one place, the backend** (`backend/src/lib/themes.ts`); web and admin hold no copy, and a test
asserts the Emerald preset still equals the `:root` block of `globals.css` so the default cannot drift.

## 2. Typography

| Role | en | ar |
|---|---|---|
| Headings, numerals, buttons | **Readex Pro** | **Readex Pro** (same family, Arabic subset) |
| Body, UI | **IBM Plex Sans** | **IBM Plex Sans Arabic** |

Readex Pro is one family for both scripts and has a weight axis (160–700) and a width axis (`HEXP` 0–100), loaded through `next/font/google` (variable, per-locale subsets, `preload: false` as today). Weight and width are the design device:

- Hero headline: weight 300, `HEXP` 30, very large. A light, wide face at 56–72 px is the confident gesture. Nothing inside it is accented.
- Section titles: weight 600, `HEXP` 0, one step smaller. Product titles and buttons: weight 500.
- Latin headings get `letter-spacing: -0.02em`. **Arabic never gets negative or positive tracking** (it breaks the joins).

Scale (major third, 1.25; base 16 px), fluid at the top:

| Step | rem / px | Use | Line-height en / ar |
|---|---|---|---|
| −1 | 0.8125 / 13 | Chips, captions | 1.4 / 1.7 |
| 0 | 1 / 16 | Body, UI | 1.6 / 1.85 |
| 1 | 1.25 / 20 | Lead sentence, product title on the product page | 1.5 / 1.75 |
| 2 | 1.5625 / 25 | Card group titles | 1.3 / 1.6 |
| 3 | 1.95 / 31 | Section titles | 1.2 / 1.5 |
| 4 | 2.44 / 39 | Page titles | 1.15 / 1.45 |
| 5 | `clamp(2.5rem, 6vw, 4.5rem)` | Hero headline only | 1.05 / 1.35 |

Measure: body copy `max-width: 65ch` (never above 75 characters); descriptions and condition notes the same. Numerals are Western digits, tabular in prices. Sentence case everywhere, no letter-spaced capitals.

## 3. Space, shape, depth

- 8 px grid; container 1280 px; page gutter 16 px mobile / 32 px desktop; vertical rhythm between home blocks 80 px desktop / 48 px mobile. Generous, not uniform: the hero and the shelf get more air than the footer.
- Radius: `sm 6px` (chips, fields), `md 10px` (buttons), nothing larger except the arch. Product images have **square corners**.
- **No shadows on content.** Depth comes from sand backdrops and white space. Only floating layers (drawer, toast, mega-menu) carry one soft shadow token.
- Hairlines: 1 px `--border`. No card borders around products.

## 4. The arch (the signature)

One SVG `clipPath` in `objectBoundingBox` units, so it scales to any box and is symmetric (RTL needs no mirroring of the shape):

```
M0 1 V0.5 C0 0.22 0.3 0.1 0.5 0 C0.7 0.1 1 0.22 1 0.5 V1 Z
```

A pointed Najdi-style arch: straight sides, shoulders that rise to a soft point. Used in exactly three places, always at an aspect ratio of 4:5 (hero) or 3:4 (tiles):

1. **Hero image** (admin banners fill it and rotate).
2. **Category tiles** in the horizontal row.
3. **Auth pages** image panel.

Detail that carries the identity: behind the hero arch sits a second arch outline in `--gold`, 1.5 px, offset 14 px up and toward the page edge (it mirrors in RTL because it uses logical offsets). Nothing else is arched. Product images, banners elsewhere, avatars: square.

## 5. Components

- **Header (slim, 64 px):** wordmark, a wide search field (the centre of the header, always visible from md; an icon that expands from sm), icons for favourites (count), account, cart (count); categories open a mega-menu from a "Categories" link. No bell clutter for guests.
- **Wordmark:** "Furnixa" / "فرنيكسا" in Readex Pro 600 with the thin gold underline (kept from ADR-014 until a logo exists, B-006).
- **Buttons:** primary = emerald fill, white text; secondary = 1.5 px emerald outline, emerald text; text link = emerald underline on hover. Labels say what happens ("Add to cart", "Place order, pay on delivery"). No trailing arrows. The shimmer effect is removed.
- **Chips:** `New` emerald/white; `Pre-owned, like new` sand/ink; `Sold out` ink outline. Chips sit **under** the image next to the price, never on top of a photo.
- **Product tile (no border, no shadow):** sand backdrop at 4:5 with the photo multiplied onto it (`mix-blend-mode: multiply`, so white studio shots melt into the sand); heart in the top-end corner (paper circle, 36 px); title (2 lines max, Readex 500); price; condition chip. Quick add: a full-width text button below on mobile, revealed on hover/focus on desktop. Second image crossfades on hover (desktop only).
- **Segmented switch** (shelf): two options, ink-outlined, the active one filled ink with paper text; keyboard arrows move between them.
- **Condition report** (pre-owned product page): see the product wireframe. Real data only: grade (existing field), the seller-written notes (existing `conditionNotes`), the extra photos, and the byline "Photos and condition notes by Furnixa". The app never claims inspection until the owner confirms it in writing (B-036, Q-2); then one string per language changes.
- **Footer:** one emerald block: contact, cities served (from settings), COD in one plain sentence, language switch. Sand text on emerald; links underline on hover.
- **Toast:** sonner, paper surface, one soft shadow.

## 6. Layout (wireframes)

Desktop 1440 (LTR; in RTL everything mirrors, the arch stays symmetric).

```
HOME 1440
+--------------------------------------------------------------------------------+
| Furnixa_   [ Search sofas, beds, dining tables...        ] Categories  ♡  👤  🛍 |  64px
+--------------------------------------------------------------------------------+
|                                                                                |
|  Sofas, beds and dining tables         ,-----------.                           |
|  for your home                        /  (gold arch  \   <- banner image inside |
|  (Readex 300, 72px, 2 lines)         |   outline)     |     the arch, rotates   |
|                                      |   [ image ]    |                        |
|  New pieces and pre-owned furniture |                |                        |
|  furniture. Delivered to Riyadh,     |                |                        |
|  Jeddah and Dammam. Pay on delivery. |                |                        |
|                                      |                |                        |
|  [ Shop new ]  [ Shop pre-owned ]    |________________|     ( • ○ ○ )          |
|                                                                                |
+--------------------------------------------------------------------------------+
|  Shop by room                                                                  |
|   ,--.   ,--.   ,--.   ,--.   ,--.   ,--.   ,--.  -> horizontal scroll, snap    |
|  |img|  |img|  |img|  |img|  |img|  |img|  |img|   arch tiles 3:4, name below  |
|  Living Bedroom Dining Office  Kids   Outdoor Storage                          |
+--------------------------------------------------------------------------------+
|  [ New | Pre-owned ]                                         See all new        |
|  +------+ +------+ +------+ +------+     sand backdrops, no borders             |
|  |sand  | |sand ♡| |sand  | |sand  |                                           |
|  |image | |image | |image | |image |                                           |
|  +------+ +------+ +------+ +------+                                           |
|  Title    Title    Title    Title                                              |
|  SAR 1,950 ...                  [chip]                                         |
+--------------------------------------------------------------------------------+
|  How pre-owned works  (the only numbered block: a real 3-step sequence)        |
|  1 Browse   2 Read the condition report   3 Order and pay on delivery         |
+--------------------------------------------------------------------------------+
|  EMERALD FOOTER: contact | cities served | cash on delivery | language         |
+--------------------------------------------------------------------------------+

HOME 390: header = wordmark + icons (search opens a sheet); headline 40px; arch image
full-width under the text; two buttons stacked full width; category arches scroll with a
peek of the next; shelf is 2 columns; footer stacks.
```

```
LISTING 1440                                   PRODUCT 1440
+--------------------------------------+      +----------------------------------------------+
| Sofas (128)         Sort: Newest  v  |      | Home / Sofas / Oak sofa                      |
| [New][Pre-owned]  chips: x Oak       |      | +----------------+  +-----------------------+ |
| Filters (start side)  | grid 4 cols  |      | | big image      |  | Oak three-seat sofa   | |
| Category              | tile tile .. |      | | (sand)         |  | SAR 3,450  [chip]     | |
| Price   ----o---o-    | tile tile .. |      | |                |  | In stock. Delivered   | |
| Condition [] [] []    |              |      | +--+--+--+--+----+  | in 3 to 5 days        | |
| Material              | pagination   |      | |th|th|th|th|      | [ Add to cart       ] | |
+--------------------------------------+      |                    | [ ♡ Save ] (sticky)  | |
390: filters in a bottom sheet,                | Condition report (pre-owned only)             |
grid 2 columns, sort in the same sheet.        |  Grade [ New | Like new |*Good*| Fair ]      |
                                               |  Our notes: honest text, 65ch                |
                                               |  [close-up][close-up][close-up]              |
                                               |  Photos and notes by Furnixa.                |
                                               | Details / Delivery & COD                     |
                                               +----------------------------------------------+
390: gallery swipes, buy box becomes a sticky bottom bar (price + Add to cart).
```

```
CART PAGE 1440                                  AUTH 1440
+-----------------------------------------+    +----------------------------------------+
| Your cart (3)                           |    | Furnixa_               ,---------.      |
| [img] Oak sofa      - 1 +    SAR 3,450  |    |                       /   arch    \     |
|       Remove                            |    | Log in                |  image on  |    |
| ---------------------------------------  |    | Email [          ]    |  sand      |    |
| [img] ...                               |    | Password [       ]    |            |    |
|                                         |    | [ Log in ]            |____________|    |
|        Free-delivery bar (gold-strong)  |    | New here? Create an account            |
|        Subtotal / Delivery / VAT / Total|    +----------------------------------------+
|        [ Checkout ]  (sticky on 390)    |    390: form only, a small arch above the title.
+-----------------------------------------+    OTP: six boxes, answers input only.
Checkout: one column, address then review, COD is the only payment, summary sticky on desktop.
```

## 7. Motion

| Where | Library | What |
|---|---|---|
| **Page load, home only (the one orchestrated moment)** | GSAP | The hero arch reveals (clip grows from the base, 700 ms), then the gold arch outline draws, then the headline settles (weight 300, rises 16 px, 500 ms). One timeline, once. The hero image is already painted (LCP); the timeline only animates the clip and transform. |
| Heart, add to cart (fly dot + toast), cart drawer, OTP boxes, segmented switch, mega-menu | Framer Motion | Answers a user action, 200–350 ms. |
| Hero rotation | CSS/React | Crossfade between banners every 7 s, paused on hover/focus; under reduced motion no auto-rotation, manual dots only. No zoom, no parallax. |

Removed from v1: scroll reveals on every section, AOS, the page enter transition, the testimonials marquee, the hero zoom and parallax, the shimmer CTA. Under `prefers-reduced-motion` the hero is shown complete and nothing moves except what the user triggers, without the flourish. Only `transform`, `clip-path` and `opacity` animate; the LCP image is never hidden.

## 8. Copy rules

Sentence case, plain words, real furniture vocabulary (sofa, wardrobe, dining table, mattress), buttons name the result. Arabic is written natively, not translated from English:

| | en | ar |
|---|---|---|
| Hero headline | Sofas, beds and dining tables for your home | كنب وغرف نوم وطاولات سفرة لبيتك |
| Hero sentence | New pieces and pre-owned furniture with a clear condition grade, delivered to your door. You pay when it arrives. | قطع جديدة وأخرى مستعملة بدرجة حالة واضحة، تصلك إلى باب بيتك، وتدفع عند الاستلام. |
| Actions | Shop new / Shop pre-owned | تسوّق الجديد / تسوّق المستعمل |
| Condition report title | Condition report | تقرير الحالة |
| Grade wording (approved by the owner 2026-11-24, Arabic edited) | Like new: used a few times, no marks we could find. | استُخدمت مرات قليلة ولم نجد فيها أي علامات. |
| Grade wording, Fair | Used, with clear signs of wear. Read our notes for the details. | مستعملة وعليها علامات استخدام واضحة. اقرأ ملاحظاتنا لمعرفة التفاصيل. |

## 9. RTL rules

Use Tailwind logical utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`). Directional icons use `rtl:rotate-180`. Carousels and the category row set `dir`; scroll-snap start is the inline start. The hero text sits on the start side and the arch on the end side in both directions. Never hard-code `left/right`.

## 10. Iconography & imagery

Lucide, 1.5 stroke, date gold only for the few decorative lines, ink elsewhere. Photography: furniture on a neutral studio backdrop that melts into sand (multiply). Pre-owned pieces get the same backdrop plus close-ups of wear, which are the evidence behind the condition report.

## 11. Numbers, currency, dates & phone formatting

Locale tags: `ar` → `ar-SA` (default), `en` → `en-SA` (ADR-008). Use `Intl` everywhere; never hand-format numbers or hard-code the currency symbol.

| What | Rule |
|---|---|
| Price | One shared helper `formatPrice(halalas, locale)`: `amount = halalas / 100`; `new Intl.NumberFormat(tag, { style: 'currency', currency: 'SAR', minimumFractionDigits: halalas % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })`. Whole riyals show without decimals; otherwise two decimals. The symbol/code comes from `Intl`. |
| Digits and calendar | **Draft (B-015):** Western digits and Gregorian dates, pinned with Unicode extensions: numbers `ar-SA-u-nu-latn` / `en-SA-u-nu-latn`; dates `ar-SA-u-ca-gregory-nu-latn`. Without pinning, `ar-SA` may render Arabic-Indic digits and the Hijri calendar depending on the ICU/CLDR version. Order numbers (`FX-20261120-0042`) always use Western digits. |
| Plain numbers | `Intl.NumberFormat(tag)`; stock counts, quantities and percentages follow the same digit rule. |
| Dates | `Intl.DateTimeFormat(tag, { dateStyle: 'medium' })` and `timeStyle: 'short'` in order timelines, notifications and emails. |
| Prices in RTL | Wrap the formatted price in `<bdi>` (or `dir="auto"`) so the symbol and number do not reorder inside Arabic text. Struck-through compare-at price sits after the price on the end side. |
| Phone display | `+966 5X XXX XXXX`, rendered with `dir="ltr"` inside RTL layouts. Inputs use `type="tel"`, `inputMode="tel"`, a fixed `+966` prefix chip on the start side, and the shared Saudi phone validator (NFR-06). |
| VAT | Shown only when `vatRate` > 0 in admin settings (ADM-14); with `vatRate` 0 no VAT line or note appears anywhere. A delivery fee of 0 renders as the localized "Free delivery" label, not "SAR 0". Price note beside product prices: "Incl. VAT" / "+ VAT" in muted small text (`--muted-foreground`, 12 px), localized via message files. Cart, checkout and invoice show a VAT line with `formatPrice` and the rate as a percent (`Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 2 })`). VAT registration number is shown as digits with `dir="ltr"`. |

RTL is the default: design and review every screen in Arabic first, then check English.
