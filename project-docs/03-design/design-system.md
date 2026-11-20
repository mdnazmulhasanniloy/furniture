# Design System — "Warm Walnut"

Mood: warm, crafted, calm. Feels like a well-lit showroom — natural wood, linen, clay, a touch of olive green. Works equally in LTR and RTL.

## 1. Colour tokens

Defined as CSS variables (HSL, shadcn convention) in both `web` and `admin`. daisyUI theme `furnixa` maps to the same values.

| Token | Hex | Use |
|---|---|---|
| `--background` | `#FBF8F3` (linen) | Page background |
| `--foreground` | `#1F1A17` (espresso) | Body text |
| `--card` | `#FFFFFF` | Cards, sheets |
| `--muted` | `#F2EBE1` (sand) | Section bands, inputs |
| `--muted-foreground` | `#6B5E54` | Secondary text |
| `--primary` | `#8B5A3C` (walnut) | Primary buttons, links |
| `--primary-foreground` | `#FFFFFF` | Text on primary |
| `--secondary` | `#5F6F52` (olive) | Resale badge, secondary CTA |
| `--accent` | `#C8794A` (terracotta) | Highlights, price, sale |
| `--gold` | `#C9A66B` (brass) | Featured badge, dividers |
| `--border` | `#E6DCCF` | Borders |
| `--ring` | `#8B5A3C` | Focus ring |
| `--destructive` | `#B4442E` | Errors, cancel |
| `--success` | `#3F7D58` | Delivered, success |
| `--warning` | `#C98A1A` | Pending, low stock |

Dark mode (admin only in MVP): background `#16120F`, card `#1F1A16`, foreground `#F3ECE3`, primary `#C08A62`, border `#3A312A`.

Contrast check: walnut `#8B5A3C` on white = 6.0:1 ✓; muted-foreground on linen ≈ 5.6:1 ✓; terracotta on white ≈ 3.2:1 → use only for large text/price ≥ 18 px or icons.

Order status colours: PENDING warning · CONFIRMED primary · PROCESSING gold · OUT_FOR_DELIVERY secondary · DELIVERED success · CANCELLED destructive.

## 2. Typography

| Role | Latin (en) | Arabic (ar) |
|---|---|---|
| Display / headings | **Fraunces** (600, optical size) | **Noto Kufi Arabic** (600/700) |
| Body / UI | **Manrope** (400/500/600) | **IBM Plex Sans Arabic** (400/500/600) |

Loaded via `next/font` (web) / `@fontsource` (admin). Scale (rem): 0.75, 0.875, 1, 1.125, 1.25, 1.5, 2, 2.5, 3.5, 4.5. Arabic line-height +0.1 vs Latin.

## 3. Space, radius, shadow

- 4 px base grid; container max 1280 px; section padding 96 px desktop / 56 px mobile.
- Radius: `sm 6px`, `md 10px`, `lg 16px`, `xl 24px` (product cards = lg, hero = xl).
- Shadow: soft warm `0 8px 24px -12px rgb(60 40 25 / 0.18)`; hover lift `translateY(-4px)`.

## 4. Components

- Base: **shadcn/ui** (Radix) for all interactive components in both apps — Button, Input, Select, Dialog, Sheet, DropdownMenu, Tabs, Toast (sonner), Table (+ TanStack Table in admin), Form (react-hook-form + zod).
- **Magic UI** for showcase pieces on the website only: Marquee (brand/testimonial strip), BlurFade, NumberTicker (stats), ShimmerButton (hero CTA), BentoGrid (category grid).
- **daisyUI**: not used by default to avoid two competing theme systems (see ADR-004). Allowed only for isolated utility pieces if the team decides.
- Badges: `New` (primary outline), `Pre-owned · {grade}` (olive filled), `Featured` (brass), `Sold out` (muted).
- Product card: 4:5 image, second image crossfade on hover, title (2 lines), price + compare-at struck, type badge, quick-add button.

## 5. Motion

| Library | Where | Rules |
|---|---|---|
| Framer Motion | Page transitions, cart drawer, modals, card hover, layout animations, toasts | 200–400 ms, ease `[0.22, 1, 0.36, 1]` |
| GSAP + ScrollTrigger | Home hero (staggered headline, parallax furniture image), "How resale works" pinned section | Home page only; kill on unmount |
| AOS | Simple fade-up reveals on content pages and section headings | `once: true`, offset 80, duration 600 |

All motion is disabled/reduced under `prefers-reduced-motion`. GSAP x-translations flip sign in RTL.

## 6. RTL rules

Use Tailwind logical utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`). Directional icons (arrows, chevrons) use `rtl:rotate-180`. Carousels set `dir`. Never hard-code `left/right`.

## 7. Iconography & imagery

Lucide icons, 1.5 stroke. Photography: warm natural light, neutral backdrops; resale items photographed with the same backdrop for consistency (guideline for client).

## 8. Numbers, currency, dates & phone formatting

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
