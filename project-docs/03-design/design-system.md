# Design System — "Emerald and gold"

Mood: calm, bright, showroom. White canvas, deep emerald, brass accents. Works equally in LTR and RTL. (Replaces "Warm Walnut", CR-007 / SRC-008, ADR-014. ADR-004 is unchanged: shadcn/ui stays the base.)

## 1. Colour tokens

Defined as CSS variables in both `web` (`globals.css`) and `admin` (`index.css`). Components use token classes only, never hex values. All values below are a contract checked by the AA test (UI-02, see "Contrast" below).

| Token | Light | Dark (admin) | Use |
|---|---|---|---|
| `--background` | `#FFFFFF` | `#0E1513` | Page |
| `--foreground` | `#1C2321` | `#EEF2F0` | Body text |
| `--card` | `#FFFFFF` | `#15201D` | Cards, sheets |
| `--muted` | `#F4F6F5` | `#1A2522` | Bands, skeletons, progress track |
| `--muted-foreground` | `#5F6B66` | `#A3B0AB` | Secondary text |
| `--primary` / `--primary-foreground` | `#0F4C45` / `#FFFFFF` | `#4FB3A3` / `#0E1513` | Buttons, links, "New" badge |
| `--secondary` / `--secondary-foreground` | `#F6EFD9` / `#6B5318` | `#2A2616` / `#E9DDB8` | "Pre-owned" badge, soft CTA |
| `--gold` / `--gold-foreground` | `#C8A24A` / `#1C2321` | `#D9B865` / `#1C2321` | Decoration, icons, CTA fill, "Featured" badge. **Never as text on white.** |
| `--gold-strong` | `#9C7A2E` | `#D9B865` | Meaningful gold graphics (free-delivery progress fill; ≥ 3:1 on white and muted) |
| `--price` | `#86672A` | `#D9B865` | Amounts only (`Price` component) |
| `--border` | `#E6E9E7` | `#24302D` | Decorative dividers only |
| `--input` | `#7D8A85` | `#6B7A75` | Form-field borders (3:1) |
| `--ring` | `#0F4C45` | `#4FB3A3` | Focus ring |
| `--destructive` | `#B42318` | `#F28B82` | Errors, cancel (text and fills) |
| `--success` | `#1F7A4D` | `#5CC38F` | Delivered, success |
| `--success-foreground` | `#17603B` | `#5CC38F` | Text on success tint |
| `--warning` | `#B7791F` | `#E3A93E` | Icons and badge backgrounds **only** |
| `--warning-foreground` | `#7A4B05` | `#E3A93E` | Text (the "darkest shade") on warning tint |

`--accent` is removed. Amounts use `--price`; decorative highlights use `--gold`; the six former call sites move to `primary` or `gold` by meaning.

Contrast (computed, WCAG relative luminance; enforced by tests in `web` and `admin`): foreground and muted-foreground on background, card and muted ≥ 4.5:1; `--price` on the same surfaces ≥ 4.5:1; every Button variant text on its fill and every badge text on its fill ≥ 4.5:1; ring, `--input` and `--gold-strong` against the surface they sit on ≥ 3:1. Known figures: muted-foreground on white 5.55, price on white 5.27, white on primary 9.81, gold button text 6.65, Pre-owned badge 6.35, warning-foreground on white 7.4, `--gold-strong` on white 4.01 and on muted 3.69, `--input` on white 3.59. Raw `--warning` as text (3.64) and raw `--gold` as text on white (2.41) are forbidden.

Order status colours: PENDING warning badge (text `warning-foreground`) · CONFIRMED primary · PROCESSING gold · OUT_FOR_DELIVERY secondary · DELIVERED success · CANCELLED destructive.

## 2. Typography

| Role | Latin (en) | Arabic (ar) |
|---|---|---|
| Display / headings | **Fraunces** (600, optical size) | **Noto Kufi Arabic** (600/700) |
| Body / UI | **Manrope** (400/500/600) | **IBM Plex Sans Arabic** (400/500/600) |

Loaded via `next/font` (web) / `@fontsource` (admin). Scale (rem): 0.75, 0.875, 1, 1.125, 1.25, 1.5, 2, 2.5, 3.5, 4.5. Arabic line-height +0.1 vs Latin.

## 3. Space, radius, shadow

- 4 px base grid; container max 1280 px; section padding 96 px desktop / 56 px mobile; gap between home sections at least 64 px desktop / 40 px mobile.
- Radius: `sm 6px`, `md 10px`, `lg 16px`, `xl 24px` (product cards = lg, hero = xl).
- Shadow tokens only (`--shadow-soft`: `0 8px 24px -12px rgb(15 76 69 / 0.18)`); hover lift `translateY(-4px)`. Radius and shadow come from tokens, never literals.

## 4. Components

- Base: **shadcn/ui** (Radix) for all interactive components in both apps — Button, Input, Select, Dialog, Sheet, DropdownMenu, Tabs, Toast (sonner), Table (+ TanStack Table in admin), Form (react-hook-form + zod).
- **Magic UI** for showcase pieces on the website only: Marquee (brand/testimonial strip), BlurFade, NumberTicker (stats), ShimmerButton (hero CTA), BentoGrid (category grid).
- **daisyUI**: not used by default to avoid two competing theme systems (see ADR-004). Allowed only for isolated utility pieces if the team decides.
- Badges: `New` (primary fill, white text) · `Pre-owned · {grade}` (secondary fill, secondary-foreground text) · `Featured` (gold fill, gold-foreground text) · `Sold out` (muted fill, muted-foreground text). Status badges: tinted background of the status colour, text in its `*-foreground` shade (warning uses `--warning-foreground`).
- Toast: sonner (approved), styled with tokens, RTL-aware position.
- Product card: 4:5 image with a second-image crossfade on hover (Framer Motion), type/condition badge, animated heart favourite toggle (FAV-01), title in 2 lines, price in `--price` (compare-at struck after it on the end side), quick "Add to cart" button; at stock 0 the button is disabled and reads "Sold out". Hover lift only on hover-capable devices.
- Placeholder (B-022, B-006): when an image is missing, an emerald pattern with the brand mark. Until a real logo exists the mark is a text wordmark "Furnixa" / "فرنيكسا" in Fraunces / Noto Kufi Arabic with a thin gold underline (also used in header and auth panel). A logo set in Site Settings replaces it.
- Auth: split layout, emerald side panel with a gold accent line, lifestyle image panel (placeholder), animated 6-box OTP.
- Cart: gold free-delivery progress bar (`--gold-strong` fill on a muted track with a 1 px `--input` outline; the text label carries the meaning), quantity stepper, remove with undo toast, VAT line only when > 0.

## 5. Motion

| Library | Where | Rules |
|---|---|---|
| GSAP + ScrollTrigger | Home hero (headline stagger, slow image zoom started after load), home section reveals, "How resale works" pinned section | Home page only; dynamically imported; kill on unmount; never delays the LCP image |
| Framer Motion | Product cards (hover lift, image crossfade, heart), cart drawer, modals, page **enter** transitions, add-to-cart fly-to-cart + toast | 200–400 ms, ease `[0.22, 1, 0.36, 1]`; the App Router cannot animate route exits, so page transitions are enter-only |
| AOS | Content-page reveals (static pages, account headings) | `once: true`, offset 80, duration 600 |

All motion reads one shared reduced-motion hook: under `prefers-reduced-motion` animation is disabled or reduced to opacity. x-offsets and slide directions flip sign when `dir="rtl"`. Only `transform` and `opacity` are animated. LCP < 2.5 s on mobile (PRD G4): the first hero slide image loads with priority, other slides lazily.

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
