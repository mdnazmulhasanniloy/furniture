# CR-010 plan: Admin-selectable colour theme

Source: `SRC-011` (owner brief, 2026-11-24; see `01-discovery/client-notes-2026-11-24.md`, addendum 4). Design record: `ADR-017`. Status: **proposed, waiting for approval. Plan only: nothing is built, and implementation starts only after CR-009 (home v4) is approved.** Branch for the build: created from the CR-009 branch once it is approved.

## 1. What the owner gets

Admin > Settings > Appearance: five preset themes as cards, each with a live preview of a product tile, a button and a price, and one "Apply" button. No free colour picker. The chosen theme changes the whole storefront (the CSS variables on `<html>`), is applied on the server so there is no flash of the default theme, and reaches visitors within a short cache window (immediately once the web revalidation route exists).

## 2. The presets (all computed against the existing AA gate)

Five presets, one default: **Emerald** (the current look, default), **Walnut** (warm brown, copper accent), **Charcoal** (near-black, brass accent), **Sand** (olive-bronze, the warmest and quietest), and a fifth I propose, **Indigo** (deep blue, a colour not otherwise in the set and common in Saudi branding). Names in Arabic: الزمرد، الجوز، الفحم، الرمل، النيلي.

**What a theme changes (12 CSS variables, the brief's list mapped onto the real tokens):**

| Brief | Token(s) |
|---|---|
| primary, primary-foreground | `--primary`, `--primary-foreground` |
| accent | `--gold` (decorative lines, footer hairline) and `--gold-strong` (the meaningful gold graphic: the free-delivery bar) |
| surface | `--muted` and `--secondary` (the sand backdrop behind photos, chips, quiet bands) |
| muted | `--muted-foreground` (secondary text) and `--stone` (icons, hairlines) |
| border | `--border` and `--input` (decorative dividers; form-field border) |
| price | `--price` |
| focus ring | `--ring` |

**What a theme never changes:** paper (`#FFFFFF`), ink (`#14201D`), `--gold-foreground`, the status colours (destructive, success, warning and their text shades). Order and stock states must read the same in every theme, and body text stays at the proven 16.8:1. All presets are light themes; the admin dark mode is not part of this.

Token values:

| Token | emerald | walnut | charcoal | sand | indigo |
|---|---|---|---|---|---|
| primary | `#0F4C45` | `#6B3F2A` | `#2B3236` | `#4D4430` | `#1F3A5F` |
| onPrimary | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| ring | `#0F4C45` | `#6B3F2A` | `#2B3236` | `#4D4430` | `#1F3A5F` |
| muted | `#EFE9DD` | `#F0E7DC` | `#ECEDEE` | `#E9E0CF` | `#E8ECF1` |
| mutedFg | `#5C6360` | `#5E5249` | `#54595C` | `#5A5446` | `#4F5B6A` |
| stone | `#6B726F` | `#756A60` | `#6F7479` | `#6E6858` | `#6A7585` |
| border | `#E4E0D6` | `#E6DCD0` | `#DFE1E2` | `#DDD3BF` | `#DCE1E8` |
| input | `#7D8A85` | `#85786C` | `#7C8286` | `#80765F` | `#76849A` |
| gold | `#B8913A` | `#C58E4E` | `#A8905A` | `#BCA264` | `#A8864A` |
| goldStrong | `#9C7A2E` | `#8F5F2A` | `#857037` | `#85702F` | `#85692F` |
| price | `#7A5E22` | `#77491B` | `#5F5226` | `#6E5A22` | `#6C5421` |

Contrast, computed with the same relative-luminance formula as the web and admin tests (every cell must reach the number in brackets; every cell does):

| Check (minimum) | emerald | walnut | charcoal | sand | indigo |
|---|---|---|---|---|---|
| ink on paper (4.5) | 16.75 | 16.75 | 16.75 | 16.75 | 16.75 |
| ink on surface (4.5) | 13.85 | 13.69 | 14.29 | 12.78 | 14.11 |
| muted text on paper (4.5) | 6.16 | 7.56 | 7.09 | 7.52 | 6.91 |
| muted text on surface (4.5) | 5.10 | 6.18 | 6.05 | 5.74 | 5.83 |
| price on paper (4.5) | 6.08 | 7.63 | 7.72 | 6.67 | 7.17 |
| price on surface (4.5) | 5.03 | 6.24 | 6.58 | 5.09 | 6.05 |
| on-primary on primary (4.5) | 9.81 | 8.86 | 13.03 | 9.61 | 11.48 |
| primary text on paper (4.5) | 9.81 | 8.86 | 13.03 | 9.61 | 11.48 |
| primary text on surface (4.5) | 8.12 | 7.25 | 11.11 | 7.34 | 9.68 |
| ring on paper (3) | 9.81 | 8.86 | 13.03 | 9.61 | 11.48 |
| ring on surface (3) | 8.12 | 7.25 | 11.11 | 7.34 | 9.68 |
| input border on paper (3) | 3.59 | 4.29 | 3.89 | 4.49 | 3.79 |
| gold-strong on paper (3) | 4.01 | 5.47 | 4.81 | 4.82 | 5.17 |
| gold-strong on surface (3) | 3.32 | 4.47 | 4.10 | 3.68 | 4.36 |
| stone icon on paper (3) | 4.93 | 5.27 | 4.72 | 5.55 | 4.67 |
| gold line on primary (footer) (3) | 3.34 | 3.10 | 4.22 | 3.89 | 3.38 |
| surface text on primary (footer) (4.5) | 8.12 | 7.25 | 11.11 | 7.34 | 9.68 |
| ink on gold (decorative CTA) (4.5) | 5.70 | 5.86 | 5.42 | 6.77 | 4.92 |

The decorative gold hairline on the footer is checked at 3:1 so it stays visible; gold is never text. Walnut and Sand needed their accent lightened once to clear that check, the values above are the adjusted ones.

## 3. Backend (spec first, then code and tests)

- **Data:** `SiteSetting.themeId String?`. Optional on purpose: existing documents have no such field, and a required Prisma scalar would fail to read them (CLAUDE.md rule 8, null-versus-missing). Readers treat `null` or a missing value as `emerald`; writers set it explicitly; the seed sets `emerald`. Plus `themeUpdatedById String?` and `themeUpdatedAt DateTime?` (who and when, see "audit" below). No migration script is needed.
- **Presets live in one place, the backend** (`src/lib/themes.ts`): id, localized name, and the 12 token values. The web and admin do not carry copies, so there is nothing to keep in sync (the three apps share no package, B-018 is still open). The id list is a TypeScript `as const` tuple used for the zod enum.
- **Endpoints:**
  - `GET /cms/settings` (public) gains `theme: { id, tokens }`: the active preset's id and its token map. A stored id that is no longer in the list resolves to `emerald`.
  - `GET /admin/settings/appearance` (admin): `{ themeId, updatedAt, presets: [{ id, name: {en, ar}, tokens }] }`, everything the Appearance tab and its previews need.
  - `PATCH /admin/settings/appearance` (admin): body `{ themeId, expectedUpdatedAt }`; `themeId` is a zod enum of the preset ids; unknown ids and unknown fields are rejected with 422 `VALIDATION_ERROR`; a stale `expectedUpdatedAt` gives 409 `STALE_UPDATE` (the same optimistic-concurrency rule as `PUT /admin/settings`). It changes only the theme, so the General, Delivery, VAT, Social and SEO forms keep working unchanged. It calls `revalidateTags(['settings'])` after the commit.
- **Why a PATCH next to the existing PUT:** `PUT /admin/settings` is a full replace; adding a required field would break every existing client and test, and a theme change should not need the whole settings form.
- **CSRF:** the project's rule (ADR-011) puts CSRF on cookie-authenticated calls only (`/auth/refresh`, `/auth/logout`); admin writes use the bearer token and have no CSRF header today, so the new PATCH follows that: bearer plus `requireRole('ADMIN')`. If you want CSRF on this endpoint as well, say so (Q-3).
- **Audit:** the repo has no audit log; the only precedent is `invitedById` on an invited admin. I propose the same level: `themeUpdatedById` and `themeUpdatedAt` on the settings document plus one structured log line (admin id, old and new theme id, request id). A real audit-log collection is a separate change (Q-3).
- **Tests (named by requirement ID):** the AA gate over every preset (the contrast table above as a test, using the same formula as the web and admin gates; a preset that fails fails CI), enum validation (unknown id, extra field, missing field, wrong type), admin-only (401, 403 for a customer), stale update 409, default when the field is missing, unknown stored id falls back, public response shape, revalidate called after commit, `themeUpdatedById` written.

## 4. Web

- **Where:** the root `[locale]/layout.tsx` already fetches `getSettings()` on the server. It builds a `style` attribute for `<html>` from `settings.theme.tokens`. Inline style on `<html>` overrides the `:root` defaults in `globals.css`, so the HTML that leaves the server already carries the chosen theme: no flash, no client script.
- **Safety:** a small `themeStyle()` helper accepts only the 12 known variable names and only values that match `^#[0-9a-fA-F]{6}$`; anything else is dropped (the values come from an API, so they are validated before they reach markup). If the API is down or `theme` is missing, the CSS defaults (Emerald) apply.
- **Cache and refresh:** the settings fetch is already cached for 60 s with the tag `settings`, and the backend already calls `revalidateTags` after settings writes. What does **not** exist yet is the web route that receives it: `web/src/app/api/revalidate` is still open task T-045 (B-028 was answered, the route was never built). Mechanism: (a) build T-045's revalidation route first, so `PATCH` is visible on the next request; (b) until then, the 60 s window is the fallback and the Appearance tab says "Visitors see the new theme within a minute". The CSS variables are on `<html>`, so no extra cache layer is involved.
- **Tests (en and ar):** theme variables appear on `<html>` for each preset, invalid values are dropped, missing theme falls back to the CSS defaults, the Emerald preset values equal the `:root` block in `globals.css` (so the default does not drift from the registry), the AA call-site scan still passes with the Emerald defaults.

## 5. Admin

- **Where:** Settings gets a sixth tab, "Appearance" (المظهر), after SEO.
- **UI:** a radio group of five cards. Each card shows the theme name, five swatches (primary, accent, surface, text-on-surface, price), and a live preview built with that preset's variables set on the card's own container (inline `style`, not on `<html>`, so the admin's own look does not change while browsing presets): a product tile (sand backdrop, title, price, condition chip), a primary button and a price. The current theme is marked "Active". Selecting a card does nothing until **Apply** is pressed; Apply is disabled when the selection equals the active theme. Result messages: success ("Theme applied. Visitors see it within a minute." / «تم تطبيق المظهر. يراه الزوار خلال دقيقة.»), stale (409, reload offer), API error (localized by code).
- **Accessibility:** cards are `role="radio"` in a `radiogroup` with arrow-key navigation; each preview exposes its text as normal text, so the preview itself is held to the same AA rules (the card's text uses the preset's own `--muted-foreground` and `--price` on the preset's surface, covered by the backend gate); the swatches have text labels, not colour alone.
- **Tests (en and ar):** five cards render with localized names, selecting enables Apply, Apply sends `PATCH` with `expectedUpdatedAt`, 409 shows the reload message, preview variables are scoped to the card (the admin root keeps its own tokens), keyboard selection.
- **Dependencies:** none new.

## 6. Proposed edits to the documents (applied only after approval)

- **`02-product/PRD.md`:** new `ADM-16 Appearance (theme preset)` · draft: an admin selects one of the preset themes in Settings > Appearance; given a preset is applied, then the storefront uses its colours on the next request after the cache window; given an unknown theme is stored, then the default applies; given two admins change it at once, then the second gets a conflict. New `UI-03 Selectable theme (storefront)` · draft: the storefront applies the active theme as CSS variables on the server; every preset passes the AA gate (text 4.5:1, graphics 3:1). `UI-02` release criterion adds "every theme preset passes the AA gate". Non-goal text "no free colour picker" recorded under ADM-16. (Not `ADM-15`: CR-009 reserves it for the shop-the-look section.)
- **`03-design/design-system.md`:** a new section "Themes": the table in section 2, the list of tokens a theme may change and the ones it may not, the rule that every preset is a light theme with paper and ink fixed.
- **`04-architecture/api-spec.yaml`:** `SiteSettings.theme` (`{ id, tokens }`) on `GET /cms/settings`; `GET` and `PATCH /admin/settings/appearance`; schemas `ThemeId` (enum), `ThemeTokens`, `ThemePreset`, `AppearanceUpdate`; the 409 `STALE_UPDATE` and 422 responses.
- **`04-architecture/data-model.md`:** `SiteSetting.themeId?`, `themeUpdatedById?`, `themeUpdatedAt?`; note that the preset registry is code, not data.
- **`04-architecture/adr/ADR-017`:** drafted now (Proposed).

## 7. Tasks (IDs provisional, next free after CR-009's T-085)

| ID | Task | Depends | Req |
|---|---|---|---|
| backend T-086 | Presets registry, `themeId` and audit fields, public `theme`, admin `GET` and `PATCH /admin/settings/appearance`, AA gate over every preset, tests | CR-009 approved | ADM-16, UI-03 |
| web T-045 (existing, todo) | `/api/revalidate` route (B-028), prerequisite for instant refresh | backend T-086 not required | UI-03 |
| web T-087 | `themeStyle()` and the `<html>` style in the layout, fallback, tests | T-086 | UI-03 |
| admin T-088 | Appearance tab: preset cards, scoped live preview, Apply, tests | T-086 | ADM-16 |

Each task: spec first, plan, tests in en and ar, typecheck, lint, i18n, build, e2e, AA gate, `/review-task`, one commit. No push. No `demo:reset` or data command (the seed adds `themeId: 'emerald'` for new seeds only; existing documents need no change).

## 8. Questions for the owner

| # | Question | Proposed answer |
|---|---|---|
| Q-1 | Is Indigo the right fifth preset, or do you prefer another (for example a deep olive or a burgundy)? | Indigo |
| Q-2 | Is it acceptable that status colours, ink and paper never change with the theme? | Yes: order states must read the same everywhere |
| Q-3 | CSRF and audit: the project has no CSRF on bearer-authenticated admin writes and no audit log. Is "who and when on the settings document plus a log line" enough, or do you want a real audit-log collection (a separate change)? | Who and when on the document plus a log line |
| Q-4 | Refresh: build the `/api/revalidate` route (T-045) first so a theme change is visible at once, or accept the 60 s window for now? | Build T-045 first; it is small and already approved by your B-028 answer |
| Q-5 | Should Apply also be available per language or per page area? | No: one theme for the whole storefront |
