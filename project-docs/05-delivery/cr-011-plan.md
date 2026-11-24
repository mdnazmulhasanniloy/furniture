# CR-011: Soft luxury storefront, banners and customer management (plan, approved 2026-11-24)

Source: owner brief SRC-012 (2026-11-24, see `01-discovery/client-notes-2026-11-24.md` addendum 5) · Branch: `redesign/home-v4` · ADR: `04-architecture/adr/ADR-018-soft-luxury-storefront.md` · **Plan only. No code until you approve. Nothing is pushed.**

## 0. State of the branch

Stopped at a clean point: `git status` is clean at `9f0f879` (T-080 backend `SHOP_THE_LOOK`). Nothing was in progress, so nothing was committed or stashed. CR-009 web tasks T-081 to T-084 were never started, so there is no web code to throw away. CR-009's split hero, announcement bar, photo panels and CR-009 sections order are **cancelled**. T-080 stays (the look section is data and API only; its use is Q-2 below). CR-010 stays approved and runs after this (see section 7).

## 1. What changes, in one paragraph

A new storefront system, "Soft luxury": confident serif headings (Bodoni Moda in English, El Messiri in Arabic), IBM Plex body, white page, the active preset's primary, a champagne gold for decorative lines only and a soft blush surface for "sweet" bands. Full-bleed bands where photos lead, container up to 1440 px, no empty gaps, image corners 4 to 8 px, no native scrollbars on rails, restrained motion (carousel crossfade, slow zoom, hover zoom, nothing on scroll). The arch is removed from the whole storefront. Three checkpoints, each ending in screenshots and a stop: (1) hero carousel, category bento and the five auth pages; (2) every other storefront page; (3) admin banners and customer management.

## 2. Design system deltas (all as theme tokens, so CR-010 presets still work)

| Item | Decision |
|---|---|
| Headings | Latin **Bodoni Moda**, Arabic **El Messiri**, both via `next/font/google` (part of Next, no npm dependency). Weights 600 and 700 only (no thin or light), because the brief's complaint is thin light headings. Sizes: hero 56 to 72 px desktop (clamp), 36 to 40 px mobile; h2 36 to 44 px; h3 24 to 28 px. |
| Body | IBM Plex Sans / IBM Plex Sans Arabic (unchanged), 16 to 17 px, line-height 1.65. |
| Font loading | Same per-locale scoping as T-030: `preload: false`, `@font-face` scoped by locale, each locale downloads only its own heading and body fonts (the existing e2e asserts this at network level; it is updated for the new families, not weakened). Readex Pro is dropped from the web. |
| New tokens | `--blush` (soft surface), `--blush-foreground` (text on it), `--champagne` (decorative lines and details). Existing `--gold` is merged into `--champagne` (same role: never text). Primary, ring, price, muted, border, input stay the active preset's. |
| Theme impact | The CR-010 token set grows from 12 to 14 variables per preset (`blush`, `champagne`; `gold` and `gold-strong` map to them). T-086 has not been built, so the registry is written once with all presets. Each preset gets its own blush and champagne, all through the AA gate. |
| Proposed Emerald values | blush `#F7EEEA` on ink `#14201D` (about 15:1); champagne `#C8A96A` used only as lines and ornaments, asserted by the gate never to appear in a text class. Final values for the five presets are computed and printed with the contrast table in the T-090 note before use. |
| Layout | Container max 1440 px with 20 / 32 / 48 px gutters. Bands may be full-bleed. Vertical rhythm: 72 px desktop, 48 px mobile between bands (a single token), no section may leave more than that gap. |
| Shape | Image corners 4 px (small) and 8 px (large). `--radius-tile` from CR-009 becomes 8 px. The `Arch` component is deleted from the web once the auth pages stop using it (T-094). |
| Rails | Native scrollbars hidden (`scrollbar-width: none`, WebKit pseudo-element), snap kept, prev/next buttons and keyboard arrows added on every rail. |
| Motion | Hero crossfade 700 ms, slow zoom 6 s, image zoom on hover/focus (scale 1.04, 400 ms), nothing on scroll. The GSAP load moment of CR-008 is removed from the home page (the hero carousel is the only motion). `prefers-reduced-motion`: no autoplay, no zoom, no hover zoom, instant slide change. Transform and opacity only; no layout properties. |
| Contrast | The AA gate (token test plus call-site scan) covers every new surface: text on the gradient scrim (checked against the worst-case photo luminance, scrim at 0.55 opacity minimum behind the text block), text on blush, buttons, chips, form fields (border 3:1), focus ring. Light headings on photos use white on the scrim only. |

## 3. Checkpoint 1 (build, screenshot, stop)

### 3.1 Hero carousel (web)
- Full-bleed. Height 85vh desktop, 70vh mobile, minimum 480 px.
- Slides = the admin's banners from `GET /cms/home` (already filtered active and scheduled, ordered). **No banners: three static demo slides** (photos in `web/public/home/`, copy in section 5).
- Slide: photo, large serif title, one line, one or two buttons, text bottom-start on a soft gradient (scrim). Banner has one CTA today; the second button appears only for the static slides (Q-3).
- Behaviour: crossfade 700 ms, slow 6 s zoom, autoplay every 6 s, thin progress bars as indicators (buttons, each a named tab-like control), prev/next arrows, swipe on touch, left/right arrow keys, **pause on hover and focus, and a visible pause/play button (WCAG 2.2.2)**. Reduced motion: no autoplay, no zoom.
- ARIA: `section role="region" aria-roledescription="carousel" aria-label`, each slide `role="group" aria-roledescription="slide" aria-label="n of N"`, `aria-live="off"` while autoplaying and `"polite"` when paused, hidden slides `aria-hidden` and `inert`.
- Images: `next/image`, `fill`, `sizes="100vw"`, `priority` and `fetchPriority="high"` only on slide 1, others `loading="lazy"`.
- Budget (unchanged from CR-009, baseline in `cr-009-plan.md` section 2): mobile LCP at most 1505 ms en and 1580 ms ar, desktop LCP at most 400 ms, CLS at most 0.042 mobile and 0.01 desktop, transfer at most +15%. Measured before and after with `web/scripts/vitals.mjs` and published as a table. Because the hero is now 85vh, slide 1 is served as AVIF/WebP at `sizes=100vw` with quality 70 and the page reserves the height with CSS (no CLS).

### 3.2 Categories, editorial bento (web)
- 5 categories by admin order. Desktop: one large tile (2 columns x 2 rows) plus four smaller; tablet 2 columns; mobile a 2-column grid of tall tiles (aspect 3:4), **no horizontal scrollbar**.
- Tile: photo, dark bottom gradient, name in the heading font, product count, image zoom on hover/focus. "View all categories" link below.
- Category photo: the category `image` if present, otherwise a deterministic fallback photo from the static set (never an empty block).
- Product count: the API's category payload must carry it. If it does not, T-092 adds a read-only `productCount` (published products only) to the public category response as an additive backend change with spec and tests (checked at task start; flagged in the plan before building).

### 3.3 Auth pages (web): login, register, verify OTP, forgot password, reset password
- Desktop: split screen, one side a full-height lifestyle photo with the logo and one short brand line (true facts only), the other side a centred form (max 440 px). The photo side is on the inline-start in LTR and mirrors in RTL. Mobile: photo as a 28vh top banner with the logo, form below.
- Floating-label inputs, show/hide password toggle, **live password rules on register** (length, letter, digit, matching the backend rule; checked against the server schema so the UI cannot be looser than the API), OTP 6 boxes with auto-advance, backspace back, paste of 6 digits, resend countdown (the existing 60 s), clear error states (field-level text plus `aria-invalid` and `aria-describedby`, focus moves to the first error, server errors mapped through the existing `errors.*` catalogue).
- Behaviour of AUTH-01 to AUTH-04 and the API is unchanged.
- Brand line: see Q-4 and the copy table (the only claim is cash on delivery, which is a fact).

### Checkpoint 1 screenshots
390, 768, 1440 and 1920 px, `/en` and `/ar`: carousel slides 1 and 2, paused state, hover tile, category grid at each width, all five auth pages including error states (wrong password, invalid OTP, weak password, mismatched confirmation) into `03-design/screens-v5/`, plus the vitals table. Then STOP.

## 4. Checkpoint 2 and 3 (outline, detail written at the checkpoint)

**Checkpoint 2, web, applied page by page:** header (transparent over the hero, solid on scroll, always solid on pages without a hero), product rails and cards, listing (sticky filter sidebar on desktop, bottom sheet on mobile), product page (large gallery with thumbnails and zoom, sticky buy box), cart, checkout, order success, account, orders, wishlist (favourites), notifications, static pages, 404 and empty states, footer. The home page's remaining sections (look, pre-owned explanation, trust strip) are decided in Q-2. At the checkpoint: screenshots, AA gate, i18n, e2e, STOP.

**Checkpoint 3A, admin banners (admin, plus backend only if needed):**
- List: table with thumbnail, title, status toggle, schedule dates, drag to reorder (hand-built pointer drag plus Move up / Move down buttons for keyboard, no dependency), edit and delete actions, empty state. Delete asks for confirmation.
- Editor: separate route (`/banners/new`, `/banners/:id`), two columns. Left, a form grouped into Content (en/ar tabs), Image (upload with preview, see Q-5), Button link, Schedule. Right, a live preview of the hero slide with a desktop/mobile toggle that uses the same slide component styles as the storefront.
- Remove anything not needed (the second banner image stays because mobile crops differ; the sort-order number field is replaced by drag).
- Reorder needs a bulk order endpoint if one does not exist (checked at task start; see section 6, `PUT /admin/banners/order`, additive).

**Checkpoint 3B, customers.** What exists today (verified in code): `GET /admin/customers` (search `q`, paging, order count), `GET /admin/customers/{id}`, `PATCH /admin/customers/{id}/block` (boolean only, revokes refresh tokens in the same transaction, disconnects sockets, `requireAuth` rejects the live access token, login and token refresh return 403 `ACCOUNT_BLOCKED`, OTP issuing is skipped for blocked users, so password reset is blocked). Admin pages `customers-page` and `customer-detail-page` with the "blocked" chip exist and are reused.

New, additive:
- **Status filter** on the list (`status=active|blocked|deleted`, default excludes deleted).
- **Block with a required reason** (3 to 300 chars, admin-only, never shown to the customer). Unblock may carry an optional reason. Stored on the user (`blockedAt`, `blockedById`, `blockedReason`); cleared fields are set to explicit null (rule 8). The customer sees one generic message in en and ar and no reason.
- **Update:** `PATCH /admin/customers/{id}` accepts `firstName`, `lastName`, `phone` only (strict zod, anything else 422). The brief says "name and phone"; I split name into first and last because the model has both (Q-6). Phone validated as +966 Saudi mobile with the existing `SaudiPhone` rules and stored as E.164. The admin never sets or sees passwords (the response never includes a hash, test asserts it). Email change is out of scope. Optimistic concurrency with `updatedAt` (409 `STALE_UPDATE`, as elsewhere).
- **Delete:** `DELETE /admin/customers/{id}` is a soft delete with anonymisation. Refused with 409 `CUSTOMER_HAS_OPEN_ORDERS` if any order is PENDING or CONFIRMED. On success, in one transaction: name becomes "Deleted customer" (a stored neutral value, not localised data), email becomes `deleted-{id}@deleted.invalid` (keeps the unique index and cannot receive mail), phone and avatar become null, all `Address` rows are deleted, refresh tokens revoked, cart and wishlist emptied, notifications deleted, passwordHash replaced with a random unusable hash, `isBlocked` true, `deletedAt`, `deletedById` set; sockets disconnected. **Orders are kept** (the address snapshot inside an order is a financial record; see Q-7 for the owner decision). The confirmation dialog makes the admin type the customer's email (the server also requires `confirmEmail` in the body and compares it to the stored email, so the check is not only in the UI).
- **Guards for every endpoint:** an ADMIN id returns 404 (customers only, as today), and an explicit check refuses acting on yourself, so no admin can block, edit or delete another admin or themselves through these routes (403 `FORBIDDEN_TARGET` is added for the self/admin case that is reachable by a crafted id; tests cover both).
- **Audit:** one structured log line per action (`customer.block`, `customer.unblock`, `customer.update`, `customer.delete`) with the actor id, target id, action, timestamp and the changed field names only. No name, email, phone or reason text in logs. Who and when are also stored on the user for block and delete. A separate audit collection is not added (Q-8).

## 5. New copy for approval (en and ar; nothing else is new)

Existing strings are reused where they already exist. Ar is written natively, not translated word by word. "—" means no string in that language is needed.

### 5.1 Hero (static demo slides, used only when the admin has no active banner)
| Key | en | ar |
|---|---|---|
| `home.carousel.label` | Featured collections | مجموعات مختارة |
| `home.carousel.slide` | Slide {n} of {total} | الشريحة {n} من {total} |
| `home.carousel.previous` | Previous slide | الشريحة السابقة |
| `home.carousel.next` | Next slide | الشريحة التالية |
| `home.carousel.pause` | Pause slideshow | إيقاف العرض مؤقتًا |
| `home.carousel.play` | Play slideshow | تشغيل العرض |
| `home.carousel.goTo` | Go to slide {n} | الانتقال إلى الشريحة {n} |
| `home.carousel.s1.title` | New furniture for every room | أثاث جديد لكل غرفة |
| `home.carousel.s1.line` | Sofas, beds and tables, delivered to your door. | كنب وأسرّة وطاولات، نوصلها إلى بابك. |
| `home.carousel.s1.cta` | Shop new | تسوّق الجديد |
| `home.carousel.s2.title` | Pre-owned, for less | مستعمل بسعر أقل |
| `home.carousel.s2.line` | Pieces with a clear condition grade, photographed and described. | قطع بدرجة حالة واضحة، مصوّرة ومشروحة. |
| `home.carousel.s2.cta` | Shop pre-owned | تسوّق المستعمل |
| `home.carousel.s3.title` | Pay when it arrives | ادفع عند وصول طلبك |
| `home.carousel.s3.line` | Cash on delivery across our Saudi cities. | الدفع نقدًا عند التسليم في مدننا السعودية. |
| `home.carousel.s3.cta` | See how it works | اعرف كيف نعمل |
| `home.carousel.s1.cta2` | Browse rooms | تصفّح الغرف |
| `home.carousel.s2.cta2` | How pre-owned works | كيف يعمل المستعمل |

Notes: s1 and s2 lines are reused from CR-009 (approved). s3 is new; "our Saudi cities" avoids a number in static copy (the real count appears on the site only where computed from settings). "How it works" links to the pre-owned explanation (home section if kept, otherwise the page `/pages/pre-owned`, Q-2).

### 5.2 Categories
| Key | en | ar |
|---|---|---|
| `home.categories.title` | Shop by category | تسوّق حسب الفئة |
| `home.categories.viewAll` | View all categories | عرض كل الفئات |
| `home.categories.count` | {count, plural, one {# product} other {# products}} | ar plural: zero «لا منتجات», one «منتج واحد», two «منتجان», few «# منتجات», many «# منتجًا», other «# منتج» |

### 5.3 Auth
| Key | en | ar |
|---|---|---|
| `auth.brand.line` (corrected, see section 12) | Cash on delivery in {count} Saudi cities. (plural) | الدفع نقدًا عند التسليم في {count} مدن سعودية. (plural) |
| `auth.field.show` / `hide` | Show password / Hide password | إظهار كلمة المرور / إخفاء كلمة المرور |
| `auth.rules.title` | Your password needs | كلمة المرور يجب أن تحتوي على |
| `auth.rules.length` | At least {n} characters | {n} أحرف على الأقل |
| `auth.rules.letter` | A letter | حرفًا واحدًا |
| `auth.rules.digit` | A number | رقمًا واحدًا |
| `auth.rules.match` | Both passwords match | تطابق كلمتي المرور |
| `auth.otp.digit` | Digit {n} of 6 | الخانة {n} من 6 |
| `auth.otp.resendIn` | Resend code in {seconds} s | إعادة إرسال الرمز بعد {seconds} ث |
| `auth.errors.summary` | Please fix the highlighted fields. | يرجى تصحيح الحقول المظللة. |

Notes: the rule list uses only rules the backend enforces (the exact wording of the length rule is read from the backend schema at build time; if the backend has no letter or digit rule, those two lines are dropped, not invented). Existing auth titles, labels and error messages are reused unchanged. The generic blocked-account message is new and listed in 5.5.

### 5.4 Admin (en and ar admin locales)
| Key | en | ar |
|---|---|---|
| `banners.preview` | Live preview | معاينة مباشرة |
| `banners.preview.desktop` / `mobile` | Desktop / Mobile | سطح المكتب / الجوال |
| `banners.section.content` / `image` / `link` / `schedule` | Content / Image / Button link / Schedule | المحتوى / الصورة / رابط الزر / الجدولة |
| `banners.reorder.hint` | Drag the handle to reorder, or use the move buttons. | اسحب المقبض لإعادة الترتيب، أو استخدم أزرار النقل. |
| `banners.moveUp` / `moveDown` | Move up / Move down | نقل للأعلى / نقل للأسفل |
| `banners.empty` | No banners yet. The home page shows the default slides until you add one. | لا توجد لافتات بعد. تعرض الصفحة الرئيسية الشرائح الافتراضية حتى تضيف لافتة. |
| `banners.delete.title` / `body` | Delete this banner? / This removes the banner from the home page. This cannot be undone. | حذف هذه اللافتة؟ / ستُزال اللافتة من الصفحة الرئيسية ولا يمكن التراجع. |
| `customers.filter.status` | Status | الحالة |
| `customers.status.active` / `blocked` / `deleted` | Active / Blocked / Deleted | نشط / محظور / محذوف |
| `customers.block.title` | Block this customer | حظر هذا العميل |
| `customers.block.reason` | Reason (required, only admins see it) | السبب (مطلوب، يراه المشرفون فقط) |
| `customers.block.confirm` | Block customer | حظر العميل |
| `customers.unblock.confirm` | Unblock customer | رفع الحظر عن العميل |
| `customers.edit.title` | Edit customer | تعديل العميل |
| `customers.edit.note` | You can change the name and phone only. | يمكنك تعديل الاسم ورقم الجوال فقط. |
| `customers.delete.title` | Delete this customer | حذف هذا العميل |
| `customers.delete.body` | Personal data is removed. Orders are kept for records. This cannot be undone. | تُزال البيانات الشخصية ويُحتفظ بالطلبات للسجلات. لا يمكن التراجع. |
| `customers.delete.typeEmail` | Type {email} to confirm | اكتب {email} للتأكيد |
| `customers.delete.confirm` | Delete customer | حذف العميل |
| `customers.error.openOrders` | This customer has pending or confirmed orders. Finish or cancel them first. | لدى هذا العميل طلبات قيد الانتظار أو مؤكدة. أنهِها أو ألغِها أولًا. |
| `customers.error.adminTarget` | Admins cannot be changed here. | لا يمكن تعديل المشرفين من هنا. |
| `customers.deletedName` | Deleted customer | عميل محذوف |

### 5.5 Storefront (customer sees)
| Key | en | ar |
|---|---|---|
| `errors.ACCOUNT_BLOCKED` (reused code, text reviewed) | This account is unavailable. Please contact support. | هذا الحساب غير متاح. يرجى التواصل مع الدعم. |

## 6. Backend and spec changes (only what the brief needs)

| Change | Where | Req |
|---|---|---|
| `User` gains `blockedReason`, `blockedAt`, `blockedById`, `deletedAt`, `deletedById` (all optional, explicit null). Additive, no migration of existing rows. | `data-model.md`, `schema.prisma` | ADM-05, ADM-17 |
| `PATCH /admin/customers/{id}/block` body becomes `{isBlocked, reason}`; `reason` required when `isBlocked: true`. Existing callers sending no reason get 422 (the admin UI is updated in the same release). | `api-spec.yaml` | ADM-05 |
| New `PATCH /admin/customers/{id}` (name, phone) and `DELETE /admin/customers/{id}` (body `{confirmEmail}`); list gets `status` filter; `CustomerListItem` gains `isBlocked`, `deletedAt`. | `api-spec.yaml` | ADM-17 |
| New error codes `CUSTOMER_HAS_OPEN_ORDERS` (409), `FORBIDDEN_TARGET` (403). | `api-spec.yaml` | ADM-17 |
| Banners: optional `PUT /admin/banners/order` `{ids: [..]}` for drag reorder (transactional, ids must equal the existing set). | `api-spec.yaml`, tests | ADM-06 |
| Public categories: `productCount` if missing (checked at T-092 start). | `api-spec.yaml` | CAT-01 |
| Theme registry gains `blush`, `champagne` (T-086, not yet built). | `cr-010-plan.md` | ADM-16 |

New requirement IDs: **ADM-17 Customer management (update, delete, block with reason)**, **UI-04 Soft luxury system (typography, tokens, carousel, bento, auth split)**; ADM-05, ADM-06, UI-01, UI-02, UI-03, AUTH-01 to AUTH-04, CAT-01 updated. Every rule above gets a test named `ADM-17 · ...` (block requires reason, revokes tokens, disconnects sockets, blocks login/refresh/reset/orders, update accepts name and phone only and rejects other fields, +966 validation, no hash in responses, delete refuses PENDING and CONFIRMED, anonymises each listed field, keeps orders, requires matching email, ADMIN target and self are refused, one log line per action with no personal data, non-admin 403). Block and delete tests also assert the customer-facing message is the same generic one.

## 7. Tasks (IDs provisional, next free after T-089)

| ID | Task | Depends | Req |
|---|---|---|---|
| **web T-045 (todo, CR-010)** | `/api/revalidate` route | none | NFR / CMS |
| web T-090 | Soft luxury foundation: fonts (Bodoni Moda, El Messiri), tokens (`blush`, `champagne`), container, rail scrollbar utility, arch removed from `hero`/`category-row` (kept in code until T-094), `design-system.md` v3, vitals script | approval | UI-04, UI-01, UI-02 |
| web T-091 | Hero carousel (banners, static fallback, ARIA, pause, swipe, reduced motion, vitals before/after) | T-090 | CAT-01, ADM-06, UI-04 |
| web T-092 | Category bento (and `productCount` if missing, with backend spec and tests) | T-090 | CAT-01, UI-04 |
| web T-093 | Auth split screen shell, floating labels, show/hide, live rules, six-box OTP, errors | T-090 | AUTH-01..04, UI-04 |
| web T-094 | Delete the `Arch` component and its tests from the web; Checkpoint 1 screenshots into `screens-v5/` | T-091..T-093 | UI-04 |
| **STOP: checkpoint 1** | | | |
| web T-095..T-103 | Checkpoint 2, one task per group (header, rails and cards, listing, product page, cart and checkout, order success and account pages, static/404/empty states, footer, home remaining sections) | approval | UI-04 |
| backend T-104 | Customer management: schema, block with reason, update, soft delete and anonymise, status filter, guards, audit log lines, spec, tests | approval of checkpoint 3 | ADM-05, ADM-17 |
| backend T-105 | `PUT /admin/banners/order` | | ADM-06 |
| admin T-106 | Banners list and editor with live preview | T-105 | ADM-06 |
| admin T-107 | Customers list filters, detail page actions, dialogs | T-104 | ADM-05, ADM-17 |
| **STOP: checkpoint 2, then checkpoint 3** | | | |

CR-010 order stays as approved: T-045 first, then T-086, T-087, T-088. T-086 is written with `blush` and `champagne` included. I propose T-045 right after Checkpoint 1 is approved so the web can read the theme live before Checkpoint 2 (Q-9).

Per task: plan, tests in en and ar, typecheck, lint, i18n check, build, e2e (`E2E_PORT=3199`), AA gate, `/review-task`, one commit. No push. No `demo:reset` or any data-deleting command; the screenshots use the data that already exists in the dev database and the static fallback slides, and anything that needs new seed data is listed for you to run, as with T-080.

## 8. Proposed edits to the documents (applied now as proposals, marked Proposed)

- `03-design/design-system.md` v3 (written in T-090): fonts, tokens, container, carousel, bento, auth split, motion.
- `02-product/PRD.md`: new `UI-04` and `ADM-17`; ADM-05, ADM-06, UI-01 (the GSAP/AOS wording is replaced by the restrained-motion rule), UI-02 and AUTH-01 notes updated.
- `04-architecture/adr/ADR-018-soft-luxury-storefront.md`: new (Proposed). Notes added to ADR-015 and ADR-016: the arch is out of the whole storefront and the CR-009 split hero is cancelled.
- `04-architecture/api-spec.yaml` and `data-model.md`: the changes in section 6 (written with the backend tasks, spec first).
- `cr-010-plan.md`: two added tokens, per preset (written when T-086 starts).

## 9. Questions for the owner

| # | Question | Proposed answer |
|---|---|---|
| Q-1 | Photos. The hero fallback slides, the auth lifestyle photo and category fallbacks need photography. I have only the demo manifest photos. | Use demo manifest photos now (clearly placeholders); you supply final photography later and I swap the files. If you have final photos, send them before T-091. |
| Q-2 | CR-009's other sections (shop the look, pre-owned explained band, trust strip, announcement bar, pre-owned picks rail) were never built on the web. The brief mentions only the hero and categories. Keep them, restyled, in Checkpoint 2? | Yes: home order = hero, categories, new arrivals and featured tabs, shop the look, pre-owned band, pre-owned picks, trust strip. Announcement bar dropped (the hero carries the cash-on-delivery message). Say if you want any of these removed. |
| Q-3 | A banner has one button; the brief says one or two buttons per slide. | Static slides get two; admin banners keep one. A second admin button needs a model change, which I would add only on request. |
| Q-4 | Auth brand line: "Cash on delivery across Saudi Arabia." is true today. It is the only claim used. | Approve, or give another true fact. |
| Q-5 | "Upload with crop preview": a real crop tool needs a library (not approved). | Preview only: the photo shown at desktop and mobile ratios inside the editor with a focal-point picker (stored as `objectPosition`), no new dependency. A real crop needs your approval of a dependency. |
| Q-6 | "Update: name and phone". The model has first and last name. | Edit both name fields and phone. |
| Q-7 | Deleted customer, orders kept. The order's address snapshot holds name, phone and address. Keep it for records, or anonymise inside the orders too? | Keep order snapshots (they are the sales and VAT record and the order total proofs) and say so in the dialog; anonymise only the account, addresses, cart, wishlist and notifications. If your lawyer says otherwise, the snapshot can be blanked after the retention period (a later task). |
| Q-8 | "Record who and when, one log line per action". Do you also want a stored audit trail in the database (a new collection the admin can read), or log lines plus the fields on the user are enough? | Log lines plus the fields on the user (no new collection). |
| Q-9 | Run T-045 (revalidate route) right after Checkpoint 1 approval, before Checkpoint 2? | Yes. |
| Q-10 | Bodoni Moda has a very high contrast (hairline strokes). At small sizes, hairlines look thin, which is the brief's complaint. | Use it from 28 px up only (headings and prices in the hero and cards); smaller headings use weight 700 and the optical-size axis. If it still looks thin in screenshots I will say so at the checkpoint. |

## 10. Owner decisions (2026-11-24, plan approved)

| # | Decision |
|---|---|
| Q-1 | Demo photos are placeholders. Final photos must be owner-supplied or commercially licensed: launch blocker **B-038**. |
| Q-2 | Keep shop the look, pre-owned band, trust strip and pre-owned picks for Checkpoint 2, restyled. Announcement bar dropped. |
| Q-3 | Admin banners keep one button. No model change. |
| Q-4 | Approved as proposed: "Cash on delivery across Saudi Arabia." is the only auth brand line. |
| Q-5 | Focal-point picker approved: store x and y percent, apply as object-position on the web at every breakpoint. No crop library. |
| Q-6 | Approved as proposed: first name, last name and phone. |
| Q-7 | Keep the order snapshot (sales and VAT record). Anonymise the account, addresses, cart, wishlist and notifications; revoke all sessions on delete; free the email (the stored email becomes a unique placeholder) so the person can register again. |
| Q-8 | Log lines plus user fields. |
| Q-9 | T-045 right after Checkpoint 1, with the security rules from B-028 (POST only, `x-revalidate-secret` via `timingSafeEqual` on SHA-256 digests, 401 with no detail when missing, wrong or unset, 400 invalid body, tag allow-list, secret never logged). |
| Q-10 | Approved. |

The focal point adds two optional numbers to the banner image (`focalX`, `focalY`, 0 to 100); the spec, backend and tests are in T-105 and the editor in T-106. The hero reads them as object-position when present.

## 11. Checkpoint 1 result (2026-11-24): STOP for owner review

Built: T-090 foundation, T-091 hero carousel, T-092 category bento (with additive backend `productCount`), T-093 auth split screen, T-094 Arch removed. Screenshots: `03-design/screens-v5/` (116 JPEGs: hero slide 1 and 2, paused state, categories, hover tile, login, login with empty fields, login with a wrong password, register with a weak password, forgot, reset, verify; 390, 768, 1440, 1920 px; en and ar).

**LCP, CLS and transfer** (`web/scripts/vitals.mjs`, production build, 5 runs, median; mobile 390x844 with 4x CPU and 1.6 Mbit/s; the demo banners from the dev API):

| Page | Before (CR-009 baseline) | After | Budget | Result |
|---|---|---|---|---|
| /en 390 | LCP 1368 ms, CLS 0.0351, 706 KB | LCP 1156 ms, CLS 0.0268, 609 KB | 1505 ms, 0.042, 812 KB | pass |
| /ar 390 | 1436 ms, 0.0417, 852 KB | 1160 ms, 0.0085, 840 KB | 1580 ms, 0.042, 980 KB | pass |
| /en 1440 | 176 ms, 0.0049, 794 KB | 300 ms, 0.0001, 850 KB | 400 ms, 0.01, 913 KB | pass |
| /ar 1440 | 208 ms, 0.0082, 941 KB | 320 ms, 0.0008, 979 KB | 400 ms, 0.01, 1082 KB | pass |

Desktop LCP is higher than before because the hero image is now full width; it stays inside the budget. Hidden slides are not downloaded with the page (slide 2 mounts 4 s after load or when shown), which is what kept desktop transfer in budget.

**Deviations and decisions to confirm**
- `--gold` and `--gold-strong` are not merged into `--champagne` yet (the cart bar and wordmark underline still use them); the merge happens in T-086 with the presets. New tokens: `--blush`, `--blush-foreground`, `--champagne`. The AA gate now also checks every text class on blush and rejects `text-champagne`.
- Existing keys `auth.otpDigit` and `auth.resendIn` are reused instead of the new `auth.otp.*` keys. `auth.rules.match` and the "mismatched confirmation" state are not built: no auth form has a confirmation field (adding one is a behaviour change you did not ask for). Old keys `auth.panelTitle`, `auth.panelText`, `auth.passwordHint` and `home.hero.*` (except `shopNew`) were removed.
- Static slide photos carry empty alt text (decorative; the slide title carries the meaning), because no alt copy was in the approved list.
- Tests replaced, not weakened: the arch hero, arch category row and arch auth tests assert behaviour you cancelled, so they were rewritten as UI-04 tests for the new behaviour (carousel ARIA, one priority image, timer, pause, reduced motion, keyboard, swipe in both directions, bento layout, fallback photos, floating labels, show/hide, live rules, error summary and focus). The Arch component's own tests went with the component (T-094). ADM-06 tests now expect one button per banner (Q-3).
- Header is still the solid header on the home page; transparent-over-hero is Checkpoint 2.
- Wrong-password screenshots made one real login attempt with a fake address against the dev API (no data written). Register, forgot and verify error states are client-side only; no account was created and no email was sent.
- Bodoni Moda: "W a" spacing in the hero headline looks loose at 72 px in /en (Q-10 follow-up); weight 700 is not thin at these sizes.

## 12. Corrections after the Checkpoint 1 review

- **Copy (review item 3):** delivery is only in the active cities, so no copy may claim "across Saudi Arabia" or "all cities". Q-4's line "Cash on delivery across Saudi Arabia." is withdrawn. `auth.brand.line` and `home.carousel.s3.line` now read "Cash on delivery in N Saudi cities." with N computed from the active delivery cities in the public settings (hidden when unavailable). The seed banner subtitle and the seed About text no longer name the whole country. CR-009's plan (cancelled) still contains the old line as history only.
