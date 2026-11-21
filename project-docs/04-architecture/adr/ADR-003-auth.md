# ADR-003: Email OTP + password, JWT access + rotating refresh cookie

Status: Accepted · Source: SRC-001.6

- Registration requires email OTP verification (6 digits, 10 min, max 5 attempts, stored hashed, never in plaintext).
- Login uses password; OTP is used for verification and password reset (not for every login) to keep login friction low. **Client to confirm** whether OTP should be required on every login (B-009).
- Access JWT 15 min (memory), refresh token **30 days** in httpOnly cookie, rotated on each refresh, stored hashed; reuse of a revoked token revokes all of the user's tokens.

**Amended 2026-11-21 (T-005):** reuse detection works on the session **family** (`RefreshToken.familyId`, set at login, kept across rotations), not on all of the user's tokens. A just-rotated token presented again within 10 s gets 401 `REFRESH_RACE` and revokes nothing; after that, reuse revokes the whole family. All of a user's tokens are revoked only on password reset and when the user is blocked. This replaces "reuse of a revoked token revokes all of the user's tokens" above.

**Amended 2026-11-20 by ADR-011:** passwords use **argon2id** (not bcrypt); refresh TTL 30 days (was 7); login lockout after `LOGIN_MAX_FAILURES`; at most `MAX_ACTIVE_SESSIONS` sessions per user; CSRF token for cookie-authenticated requests; env-driven cookie settings.
