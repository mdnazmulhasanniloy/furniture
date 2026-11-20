# Glossary

| Term | Meaning |
|------|---------|
| **New item** | Brand-new furniture sold by the store. `condition = NEW`. |
| **Resale item** | Pre-owned furniture sold by the store, graded by condition (`LIKE_NEW`, `GOOD`, `FAIR`). |
| **Condition grade** | Quality label for resale items, shown on product cards and detail page. |
| **COD** | Cash on Delivery — the only payment method in MVP. |
| **OTP** | One-time password (6 digits) sent by email, valid 10 minutes. |
| **CMS content** | Website content editable from admin: hero banners, home sections, static pages, site settings. |
| **Locale** | `ar` (RTL, default) or `en` (LTR). Every customer-facing string and translatable entity field exists in both. |
| **Halala** | Minor unit of SAR (1 SAR = 100 halalas). All prices are stored as integer halalas. |
| **Delivery city** | A Saudi city the store delivers to, managed by admin in Site Settings with an active toggle. |
| **Localized field** | A DB field stored as `{ en: string, ar: string }`. |
| **Notification** | Persistent in-app message, also pushed live over Socket.IO. |
| **Stock** | Units available. Resale items usually have stock = 1. |
