# ADR-011: Auth hardening (argon2, lockout, sessions, CSRF), Sentry and the backend environment

Status: **Accepted 2026-11-20** (team decision, SRC-006.2) · Amends ADR-003 · The backend `.env` is the real environment; `backend/.env.example` lists every key.

## Decision
- **Passwords:** hashed with **argon2id** (not bcrypt). Cost from env: `ARGON2_MEMORY_COST` (KiB, default 19456), `ARGON2_TIME_COST` (default 2), `ARGON2_PARALLELISM` (default 1).
- **Tokens:** access JWT signed with `ACCESS_TOKEN_SECRET`, TTL `ACCESS_TOKEN_TTL_SECONDS` (900 = 15 min). Refresh token TTL `REFRESH_TOKEN_TTL_SECONDS` (2 592 000 = **30 days**, was 7). Refresh tokens are stored hashed (HMAC-SHA-256 keyed with `REFRESH_TOKEN_PEPPER` — inferred from the key name), rotated on each use; reuse of a revoked token revokes the user's tokens.
- **Login lockout:** after `LOGIN_MAX_FAILURES` (default 5) consecutive failed logins for an account, login is refused for `LOGIN_LOCKOUT_SECONDS` (default 900) with 429 `ACCOUNT_LOCKED`. A successful login resets the counter. State is stored on the user (`failedLoginCount`, `lockedUntil`), so it survives restarts and multiple instances. This is in addition to the IP rate limiter (assumption: lockout is per account).
- **Sessions:** at most `MAX_ACTIVE_SESSIONS` (default 5) active refresh tokens per user. When a new login would exceed it, the oldest session is revoked (assumption; the alternative is rejecting the login).
- **CSRF:** cookie-authenticated endpoints (`POST /auth/refresh`, `POST /auth/logout`) require header `X-CSRF-Token`. The token is issued by `GET /auth/csrf` (HMAC with `CSRF_SECRET`, bound to the session cookie) and missing/invalid tokens get 403 `CSRF_INVALID`. Requests authenticated only by the `Authorization: Bearer` header are exempt. (Exact scheme is an implementation detail of T-005; this ADR fixes the contract.)
- **Cookie settings from env:** `AUTH_COOKIE_DOMAIN` (empty = host-only), `AUTH_COOKIE_SECURE` (empty = true in production, false elsewhere), `AUTH_COOKIE_SAME_SITE` (`lax` default). Cookie name stays `fx_rt`. In production `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_PEPPER` and `CSRF_SECRET` (≥ 32 chars) are required; outside production, empty values are generated randomly at start-up, which ends sessions on restart.
- **Origins:** `CORS_ALLOWED_ORIGINS` (comma-separated, with credentials; required in production), `STOREFRONT_URL`, `ADMIN_URL`. These replace `WEB_ORIGIN` / `ADMIN_ORIGIN` / `WEB_URL` in older docs.
- **Ports:** API **4100**, web **3100**, admin **3101** (were 4000 / 3000 / 5173).
- **Sentry:** `SENTRY_DSN` / `SENTRY_ENVIRONMENT`; Sentry is disabled when `SENTRY_DSN` is empty. Errors reported with the request id; no PII or secrets in events.
- **Admin seed:** `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12–128 chars), `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME`, read only by the seed script. (Name fields: B-020.)

## Not decided here (see blockers)
Where the backend runs and what that means for Socket.IO and rate limiting (B-017); repo layout / package manager (B-018); purpose of `EMAIL_LINK_TTL_SECONDS` (B-019); `firstName`/`lastName` (B-020); which jobs `CRON_SECRET` protects (B-021).

## Consequences
- AUTH-02/AUTH-05, NFR-01 and NFR-04 change (PRD v0.6). OTP codes remain 6 digits / 10 min / 5 attempts (AUTH-01) and are stored hashed, never in plaintext.
- `package.json` must swap `bcryptjs` for `argon2` and add Sentry and a CSRF helper (T-001, T-005).
