# ADR-008: Saudi market — SAR, admin-managed delivery cities, +966 phones

Status: **Accepted 2026-11-20** (client answer + correction, SRC-003.1–.3, B-002)

## Decision
**Currency**
- Single currency: **SAR**. `SiteSetting.currency` is fixed to `"SAR"` and is not editable in the admin.
- Money is an integer in minor units: **halalas** (1 SAR = 100 halalas).
- Prices are formatted with `Intl.NumberFormat` for `en-SA` / `ar-SA` through one shared `formatPrice(halalas, locale)` helper (rules in `design-system.md` §8). Never hard-code the symbol.

**Delivery cities**
- Cities live in `SiteSetting.deliveryCities: DeliveryCity[] { code, name: LocalizedText, isActive, sortOrder }`, edited in admin → Settings → Delivery.
- Seed (all active): Riyadh, Jeddah, Mecca, Medina, Dammam, Khobar.
- Addresses store `cityCode`. A city can be created, renamed, reordered and toggled; it **cannot be deleted** in the MVP (deactivate instead), and at least one city must stay active.
- The address form lists active cities only. The server re-checks the city on address create/update and again at checkout; unknown or inactive → 422 `OUT_OF_DELIVERY_AREA`.
- Orders keep an `AddressSnapshot` with `cityCode` and the localized city name, so later renames or deactivation do not change past orders.
- Delivery fee and VAT are admin-managed settings, with an optional per-city fee override (ADR-009).

**Phone numbers**
- Saudi mobile numbers, stored as E.164 `+9665XXXXXXXX`.
- Accepted input: `05XXXXXXXX`, `5XXXXXXXX`, `+9665XXXXXXXX`, `009665XXXXXXXX`; the server normalizes. One shared zod validator is used by web, admin and backend.
- Applies to profile phone and address phone. Landlines are not accepted until B-014 is answered.

## Alternatives
- Free-text city: lets orders in for areas we do not serve.
- City list in config/env: needs a deploy for every change; the client wants admin control.
- Separate `DeliveryCity` collection: more joins for a short list; the optional per-city fee (ADR-009) still fits inside the embedded type.

## Consequences
ZATCA invoicing (B-013), landlines (B-014) and digit/calendar style (B-015) are open and may extend this ADR.
