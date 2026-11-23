# ADR-011: Auth hardening (argon2, lockout, sessions, CSRF), Sentry and the backend environment

Status: **Accepted 2026-11-20** (team decision, SRC-006.2; assumptions confirmed SRC-007.5) · Amends ADR-003 · Extended by ADR-012 · The backend `.env` is the real environment; `backend/.env.example` lists every key.

## Decision
- **Passwords:** hashed with **argon2id** (not bcrypt). Cost from env: `ARGON2_MEMORY_COST` (KiB, default 19456), `ARGON2_TIME_COST` (default 2), `ARGON2_PARALLELISM` (default 1).
- **Tokens:** access JWT signed with `ACCESS_TOKEN_SECRET`, TTL `ACCESS_TOKEN_TTL_SECONDS` (900 = 15 min). Refresh token TTL `REFRESH_TOKEN_TTL_SECONDS` (2 592 000 = **30 days**, was 7). Refresh tokens are stored hashed (HMAC-SHA-256 keyed with `REFRESH_TOKEN_PEPPER`, confirmed SRC-007.5), rotated on each use; reuse of a revoked token revokes the user's tokens.
- **Login lockout:** after `LOGIN_MAX_FAILURES` (default 5) consecutive failed logins for an account, login is refused for `LOGIN_LOCKOUT_SECONDS` (default 900) with 429 `ACCOUNT_LOCKED`. A successful login resets the counter. State is stored on the user (`failedLoginCount`, `lockedUntil`), so it survives restarts and multiple instances. This is in addition to the IP rate limiter (lockout is per account, confirmed SRC-007.5).
- **Sessions:** at most `MAX_ACTIVE_SESSIONS` (default 5) active refresh tokens per user. When a new login would exceed it, the oldest session is revoked (confirmed SRC-007.5).
- **CSRF:** cookie-authenticated endpoints (`POST /auth/refresh`, `POST /auth/logout`) require header `X-CSRF-Token`. The token is issued by `GET /auth/csrf` (HMAC with `CSRF_SECRET`, bound to the session cookie) and missing/invalid tokens get 403 `CSRF_INVALID`. Requests authenticated only by the `Authorization: Bearer` header are exempt. (Exact scheme is an implementation detail of T-005; this ADR fixes the contract.)
- **Cookie settings from env:** `AUTH_COOKIE_DOMAIN` (empty = host-only), `AUTH_COOKIE_SECURE` (empty = true in production, false elsewhere), `AUTH_COOKIE_SAME_SITE` (`lax` default). Cookie name stays `fx_rt`. In production `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_PEPPER` and `CSRF_SECRET` (≥ 32 chars) are required; outside production, empty values are generated randomly at start-up, which ends sessions on restart.
- **Origins:** `CORS_ALLOWED_ORIGINS` (comma-separated, with credentials; required in production), `STOREFRONT_URL`, `ADMIN_URL`. These replace `WEB_ORIGIN` / `ADMIN_ORIGIN` / `WEB_URL` in older docs.
- **Ports:** API **1000**, web **3100**, admin **3101** (were 4000 / 3000 / 5173; API amended 4100 → **1000**, owner decision 2026-11-24).
- **Sentry:** `SENTRY_DSN` / `SENTRY_ENVIRONMENT`; Sentry is disabled when `SENTRY_DSN` is empty. Errors reported with the request id; no PII or secrets in events.
- **Admin seed:** `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12–128 chars), `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME`, read only by the seed script. `User` has `firstName` and `lastName` (B-020, SRC-007.3).

## Amended 2026-11-21 (T-005)
- **Refresh reuse:** reuse of a rotated token revokes the session **family** (`RefreshToken.familyId`), not all of the user's tokens (which are revoked only on password reset and block). 10 s grace window: `REFRESH_RACE`, nothing revoked. See ADR-003.
- **Login lockout, source of truth:** the lockout counter is the RateLimit key `login:email:<hmac>` (ADR-012 store), not the user row. While the email is locked every attempt gets 429 `ACCOUNT_LOCKED` before any password check, for known and unknown emails alike (no password oracle, no enumeration). `User.failedLoginCount` and `User.lockedUntil` remain as a **mirror** for admin visibility; the decision never reads them. This replaces "state is stored on the user" in the Login lockout bullet above.
- **CSRF scheme (the implementation detail left to T-005):** the token is `HMAC(CSRF_SECRET, familyId)`, bound to the session family, not to the cookie value, so it survives refresh rotations. It is validated by looking up the refresh cookie's row and comparing against its `familyId`. `GET /auth/csrf` without a live refresh cookie is 401. A cookie-authenticated request whose `Origin` header is present and not in `CORS_ALLOWED_ORIGINS` is 403 `CSRF_INVALID`. Bearer-only requests stay exempt.
- **Logging (NFR-04):** pino redacts `Authorization`, `Cookie`, `X-CSRF-Token`, `Set-Cookie` and `password` / `newPassword` / `code` / `token` / `accessToken` / `refreshToken` fields in every logger; Sentry events carry no request headers, cookies or body.

## Open items resolved later (SRC-007, ADR-012)
Hosting and realtime (B-017) and cron (B-021): ADR-012. Repo layout: three separate apps with `npm` (B-018). `EMAIL_LINK_TTL_SECONDS` is removed; OTP lifetime is `OTP_TTL_SECONDS=600` (B-019). `firstName` + `lastName` (B-020). Cookies: host-only on the origin that proxies `/api`, unchanged.

## Consequences
- AUTH-02/AUTH-05, NFR-01 and NFR-04 change (PRD v0.6). OTP codes remain 6 digits / 10 min / 5 attempts (AUTH-01) and are stored hashed, never in plaintext.
- `package.json` must swap `bcryptjs` for `argon2` and add Sentry and a CSRF helper (T-001, T-005).
