# ADR-017: Admin-selectable theme presets

Status: **Accepted 2026-11-24** (CR-010, SRC-011; owner approved the plan and answered Q-1 to Q-5) · Source: UI-01, UI-02, new ADM-16 and UI-03 · Builds on ADR-014 (token contract, AA gate) and ADR-015 (the Emerald values are the default). Implementation starts after CR-009 is approved.

## Correction 2026-11-25 (build of T-086): 14 tokens, not 12

ADR-018 ("soft luxury", CR-011) was accepted after this ADR and added two storefront tokens, `--blush` (a soft band
surface) and `--champagne` (decorative ornaments), noting that each preset must carry its own. The registry therefore
holds **14** variables per preset, not 12; everywhere below that says twelve, read fourteen. The two new values per
preset are in `design-system.md` section 1b, and the AA gate was extended to treat `--blush` as a third surface next to
paper and `--muted` (135 checks, all passing; the tightest new margin is `--gold-strong` on blush at 3.51 against 3).
`--champagne` is decorative only, so it is checked as a graphic and for ink on it, never as text. Nothing else in this
decision changes.

## Context

The owner wants the admin to change the storefront's colours without a developer, safely: a few presets, not a colour picker, every preset readable (WCAG AA), applied on the server so there is no flash, and visible shortly after the change.

## Decision (proposed)

1. **Presets, not free colours.** Five presets (Emerald default, Walnut, Charcoal, Sand, Burgundy). A preset changes 12 CSS variables (primary and its foreground, ring, gold and gold-strong, muted and secondary, muted-foreground and stone, border and input, price). Paper, ink, `--gold-foreground` and all status colours are fixed in every theme.
2. **The backend owns the registry.** `src/lib/themes.ts` holds ids, localized names and token values; the zod enum is built from the same tuple. The public settings response carries the active preset's tokens, and the admin Appearance endpoint carries all presets for previews. The web and admin hold no copy of the values, so nothing can drift; the Emerald preset is checked against `globals.css` by a test.
3. **Storage.** `SiteSetting.themeId` is optional (existing documents lack it; null or missing means `emerald`), plus `themeUpdatedById` and `themeUpdatedAt` as the audit trail the repo's level of precedent allows.
4. **Endpoint.** `PATCH /admin/settings/appearance { themeId, expectedUpdatedAt }`, bearer plus ADMIN role, 409 `STALE_UPDATE` on a stale write, 422 on an unknown id or field; it changes only the theme and revalidates the `settings` tag after commit. The existing `PUT /admin/settings` is untouched.
5. **Application on the web.** The root layout, which already reads the settings on the server, writes the 12 variables into the `style` attribute of `<html>` through a helper that accepts only known names and `#rrggbb` values. Inline style beats the `:root` defaults, so the first byte of HTML carries the theme. API down or no `theme`: the CSS defaults (Emerald).
6. **Refresh.** Settings are cached 60 s with the tag `settings`. The backend already posts the tag to `/api/revalidate`, which the web does not have yet (task T-045). Build that route first for instant refresh; the 60 s window is the stated fallback.
7. **Contrast is a gate on the registry.** A backend test computes the AA ratios for every preset (text 4.5:1, ring, field border and the free-delivery graphic 3:1, footer hairline 3:1) with the same formula as the web and admin tests; a failing preset fails CI. All five presets pass today.
8. **Admin previews are scoped.** Each card sets the preset's variables on its own container, so the admin's own look does not change while browsing presets.

## Consequences

- One additive backend change (three optional fields, one route pair) and no migration. Reading a document without `themeId` works.
- The storefront HTML now depends on the settings fetch for its colours, which it already did for the header, footer and SEO; no new request.
- Emails and the printed invoice are not themed.
- A change by one admin makes another admin's open settings form stale (409), which is the intended optimistic-concurrency behaviour.
- Future themes are added in one place (the registry) and are accepted only if they pass the gate.

## Alternatives considered

- A free colour picker: rejected by the owner, and it cannot guarantee contrast.
- Storing the full token map in the database: rejected, it would make contrast a runtime risk and needs a validator for arbitrary values; a fixed registry is testable.
- Copying the presets into web and admin: rejected, three copies to keep in sync with no shared package (B-018 is open).
- A client-side theme script (cookie or localStorage): rejected, it flashes the default theme and gives each visitor a different result.
- Adding `themeId` to the full-replace `PUT`: rejected, it breaks existing clients and forces the whole settings form to resend.

## Owner decisions (2026-11-24)

- Burgundy (a deep majlis red) replaces Indigo as the fifth preset; it passes the same AA gate (table in `cr-010-plan.md`).
- Ink, paper and the status colours are fixed in every theme.
- "Who and when" on the settings document plus one log line is the audit level for now.
- Build T-045 (the web `/api/revalidate` route) first. Requirements: secret from the environment, compared with `timingSafeEqual` over SHA-256 digests, POST only, rate-limited, rejects unknown tags, never logs the secret, tests for a wrong and a missing secret.
- One theme for the whole storefront.
- **CSRF, confirmed in writing (2026-11-24, from the code):** the admin app keeps its access token in memory and sends it only in the `Authorization: Bearer` header (`admin/src/lib/api/client.ts`). The backend authenticates every non-auth route only from that header (`authenticateBearer` in `src/middleware/auth.ts`); `req.cookies` is read only by the refresh and logout handlers (`session.service.ts`). The only cookie is the refresh token `fx_rt`, httpOnly, with `Path=/api/v1/auth`, so the browser does not attach it to `/api/v1/admin/...`, and the admin app does not store the access token in a cookie or in storage. A cross-site request therefore cannot carry credentials to `PATCH /admin/settings/appearance`, and no CSRF token is needed for it. (`credentials: "include"` is set on every admin request, but the path scope of the cookie keeps it off this route.)
