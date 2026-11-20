# ADR-009: Delivery fee and VAT are admin-managed settings (default 0)

Status: **Accepted 2026-11-20** (client answer SRC-004.1/.2; confirmed by the team/client with the rules in SRC-005; resolves B-003, B-011, B-012, B-016)

## Decision

**Defaults: nothing is charged until an admin sets it.** `vatRate` and `deliveryFee` default to 0; `freeDeliveryThreshold` defaults to empty (no threshold).

**Delivery fee** (Site Settings → Delivery)
- `SiteSetting.deliveryFee` = base fee in halalas (default 0). `SiteSetting.freeDeliveryThreshold` = optional; delivery is free when the subtotal is at or above it.
- Each `DeliveryCity` has an optional, admin-controlled `deliveryFee` override (null = use the base fee).
- Fee for an order = 0 if a threshold is set and met, else the city override, else the base fee, else 0.
- When the resolved fee is 0 the UI shows "Free delivery" (cart, checkout, order, invoice).

**VAT** (Site Settings → VAT)
- `SiteSetting.vat = { vatRate, applyToDelivery, pricesIncludeVat, registrationNumber? }`.
- `vatRate` is a percentage, 0–50 with up to 2 decimals, default 0. Calculations use basis points (`bp = round(vatRate × 100)`). When `vatRate = 0` no VAT line is shown on the cart, checkout, order or invoice.
- `applyToDelivery` ("Apply VAT to delivery fee"), default `true`; only has an effect when `vatRate > 0`.
- `pricesIncludeVat` default `true` (draft assumption, not stated by the client; only matters when `vatRate > 0`).
- `registrationNumber` optional; when present: 15 digits starting and ending with `3`; printed on invoices.
- Taxable base = `subtotal + (applyToDelivery ? deliveryFee : 0)`. Halalas, rounded half up once per order (not per line):
  - `vatRate = 0`: `vatAmount = 0`, `total = subtotal + deliveryFee`
  - inclusive: `vatAmount = round(base × bp / (10000 + bp))`, `total = subtotal + deliveryFee`
  - exclusive: `vatAmount = round(base × bp / 10000)`, `total = subtotal + deliveryFee + vatAmount`

**Order snapshot (immutable)**
- Every order stores `deliveryFee` and `vat: OrderVat { vatRate, vatAmount, applyToDelivery, pricesIncludeVat, registrationNumber? }`. Later setting changes never alter past orders or invoices.
- `GET /cart?addressId=` returns the city-specific fee and VAT; without `addressId` it uses the base fee.
- `POST /orders` accepts an optional `expectedTotal`; if the server total differs it returns 409 `PRICE_CHANGED` and decrements nothing, so a customer never pays a total they did not see.

## Alternatives
- Fee and VAT in env/config: needs a deploy per change; the client wants admin control.
- Per-line VAT rounding: harder to reconcile with COD totals; revisit with B-013.
- Separate `DeliveryZone` collection: more than needed for six cities.

## Consequences
- ZATCA e-invoicing (QR, e-invoice XML) is **not** covered (B-013, open); invoices stay printable order summaries with VAT breakdown and registration number.
- Seed script no longer sets 15% VAT or a fee: both start at 0 until an admin configures them.
