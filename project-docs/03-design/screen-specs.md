# Screen Specs (MVP)

Each spec lists: purpose · sections · states · requirement IDs. Visual tokens come from `design-system.md`.

## Website

### W-01 Home (CAT-01, ADM-06, ADM-07, UI-01)
- Header: logo, nav (Shop, New, Resale, Categories mega-menu), search, language switch, bell (logged in), account, cart with count.
- Hero carousel from active banners (GSAP headline stagger, parallax image, ShimmerButton CTA).
- Then sections rendered in admin-defined order: Category bento grid, Featured, New arrivals, Resale picks, Promo banner, "How resale works" (pinned GSAP, 3 steps), Testimonials marquee.
- Footer: settings contact info, social, pages links, language switch.
- States: skeletons while streaming; a section with zero products is hidden.

### W-02 Shop / Category (PROD-01)
- Desktop: filter sidebar (start side), grid 3–4 cols. Mobile: filter Sheet, grid 2 cols.
- Toolbar: result count, sort select, active filter chips (removable).
- Empty state illustration + "Clear filters". Pagination (numbered).

### W-03 Product detail (PROD-02, CART-01)
- Gallery (thumbs start side), title, badges, price, compare-at, stock text ("Only 1 left" for resale), qty stepper, Add to cart (Framer Motion fly-to-cart), condition panel (resale), specs table, delivery & COD note, related carousel.

### W-04 Cart drawer & Cart page (CART-01)
- Line items with image, title, unit price, qty stepper (max stock), remove; subtotal, delivery fee, VAT line (only when `vatRate` > 0), "Free delivery" when the fee is 0, free-delivery progress bar (only when a threshold is set), total; Checkout CTA. Without a selected address the default fee is shown with a note "Delivery fee is confirmed at checkout" when any city has a fee override.

### W-05 Checkout (ORD-01, PROF-02)
- Step 1 address (select or add inline; City is a Select of active delivery cities; phone input with fixed `+966` prefix) · Step 2 review items · Payment: "Cash on Delivery" (only option, pre-selected, info text) · Place order.
- Order summary shows subtotal, delivery fee for the selected city, VAT line (only when `vatRate` > 0), "Free delivery" when the fee is 0, total. Errors: per-item stock errors highlight the line; a `PRICE_CHANGED` response refreshes the summary and shows "Totals were updated" before the customer can place the order again.

### W-06 Auth (AUTH-01..04)
- Split layout: image panel (end side) + form. OTP screen: 6 separate inputs (shadcn InputOTP), paste support, resend countdown 60 s.

### W-07 Account (PROF-01/02, ORD-02/03, NOTIF-03)
- Tabs: Profile, Addresses, Orders, Notifications. Order detail: vertical status timeline with timestamps, Cancel button **only while status = PENDING** (ORD-03). Address form: City is a Select of active delivery cities, phone has a fixed `+966` prefix and Saudi validation; an address in a deactivated city shows a "Not deliverable" badge. All prices use `formatPrice` (`design-system.md` §8).

## Admin

### A-01 Overview (ADM-01) — 4 KPI cards (NumberTicker), line chart (Recharts), latest orders table, low-stock list.
### A-02 Products list / editor (ADM-02, I18N-02)
- List: thumbnail, name (active locale), type, price, stock (red if ≤ 2), status, actions.
- Editor: two-column; left = tabs `العربية | English` (Arabic first) for title, description, condition notes; right = price, stock, SKU, category, type/condition, dimensions, material, colour, status, featured; image uploader with drag-sort.
- Unsaved-changes guard.
### A-03 Orders (ADM-04) — status filter tabs with counts; detail: customer, address, items, totals, status stepper with allowed next actions only, internal note, Print invoice (items, subtotal, delivery fee, VAT breakdown and registration number when set, total).
### A-04 Content — banners editor with live preview card (en/ar toggle); sections drag list (dnd-kit); pages rich text (Tiptap) per locale.
### A-05 Settings (ADM-09, ADM-13, ADM-14) — tabbed form (General · Delivery · VAT · Social · SEO); save bar sticky at bottom. **VAT** tab: rate (%, default 0), "Apply VAT to delivery fee" switch (default on, disabled while rate is 0), "Prices include VAT" switch, VAT registration number (15 digits), and a live example ("100 SAR → VAT x SAR"). **Delivery** tab: base delivery fee (default 0), free-delivery threshold (optional, empty = none), then a delivery-cities table (Arabic name, English name, code, fee override (empty = base fee), active toggle, drag to reorder) with an "Add city" dialog (both names required). The last active city's toggle is disabled with a hint; there is no delete action. Currency is shown read-only as SAR.
### A-06 Shell — collapsible sidebar (mirrors in RTL), top bar with search, language, theme toggle, bell (live), avatar menu.
