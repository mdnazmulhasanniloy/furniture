# User Journeys

## J1 — First-time customer buys a resale sofa (AUTH-01, PROD-01/02, CART-01, ORD-01, NOTIF-01)
1. Lands on `/ar` from Instagram → hero animation, sees "Resale picks" section.
2. Opens Shop → filters Type = Resale, Category = Sofas, price ≤ X.
3. Opens product → views gallery, "Pre-owned · Like new", condition notes, dimensions.
4. Adds to cart (guest) → Checkout → prompted to sign up.
5. Registers → receives OTP email in Arabic → verifies → cart merges.
6. Adds address → reviews order (subtotal + delivery fee for the city, VAT line only when the admin set a rate; "Free delivery" when the fee is 0) → Place order (COD).
7. Success page with order number; email confirmation.
8. Later, admin confirms → customer sees live toast "Your order FX-… is confirmed".

## J2 — Returning customer tracks an order (AUTH-02, ORD-02, NOTIF-03)
Login → bell shows 2 unread → opens notification → order detail timeline shows `OUT_FOR_DELIVERY`.

## J3 — Forgotten password (AUTH-03, AUTH-04)
Login → "Forgot password" → email → OTP → new password → logged out everywhere else.

## J4 — Admin processes a new order (ADM-04, NOTIF-02)
Admin dashboard open → toast + sound "New order FX-… (3 items)" → opens order → Confirm → Processing → Out for delivery → Delivered (payment auto-marked PAID). Each change notifies the customer.

## J5 — Admin adds a resale item (ADM-02, I18N-02)
Products → New → Type Resale, condition Good, notes (en/ar), price, stock 1, upload 5 photos, reorder → Save as Draft → preview → Publish → appears in "Resale picks" if that section is configured as auto.

## J6 — Admin refreshes the home page for a sale (ADM-06, ADM-07, ADM-09)
Banners → new banner with start/end dates (en/ar copy, desktop/mobile images) → Home sections → move "Promo banner" to position 2 → Settings → Delivery: free-delivery threshold and a city's fee changed; Settings → VAT: rate reviewed. Website reflects changes on next request (ISR revalidate ≤ 60 s or on-demand revalidation).
