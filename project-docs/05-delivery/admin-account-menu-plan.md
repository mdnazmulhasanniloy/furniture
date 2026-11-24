# Admin account menu: Change password and Profile — plan (QA C5)

**Status: plan only, awaiting owner approval. No code has been written for this.**
Asked for in the QA batch of 2026-11-24 (item C5): the admin account menu needs "Change password"
(current password required, the shared password policy, revoke other sessions) and "Profile" (name).

Tasks: backend **T-108**, admin **T-109** (both `plan only` in `tasks/`).

---

## 1. What exists today

| Piece | State |
| --- | --- |
| Account menu (`routes/shell.tsx` → `AvatarMenu`) | Shows the admin's name, their email and **Sign out**. Nothing else. |
| `PATCH /me` | Updates `firstName`, `lastName`, `phone`, `preferredLocale`, `avatar`. It is behind `requireAuth` **only**, with no role check, so an admin may already call it. **No API change is needed for Profile.** |
| `GET /auth/me` | Returns the signed-in user; the admin store already holds it. |
| Changing a password | **Does not exist for a signed-in user.** The only path is the OTP flow: `POST /auth/forgot-password` → `POST /auth/reset-password`, which revokes every session and does not ask for the current password. |
| Revoking sessions | `revokeAllForUser` exists in `src/lib/tokens.ts` and is used by `resetPassword`, which also disconnects that user's live sockets. |
| Password policy | One file, copied per app and guarded by a byte-for-byte drift test: `backend/src/lib/passwordPolicy.ts` ↔ `admin/src/lib/password-policy.ts`. The live checklist component (`components/password-rules.tsx`) is already built and used on the invite screen. |
| `password-changed` email | Template already exists in both locales (sent by `resetPassword`). |

So: **Profile is admin-only work; Change password needs one new endpoint.**

## 2. Backend — T-108: `POST /auth/change-password`

Spec first (`api-spec.yaml`), then code, then tests.

```
POST /auth/change-password        (requireAuth, any role)
body: { currentPassword: string, newPassword: string }   // strict, no other fields
200: { accessToken, user }        // same shape as login; sets a fresh fx_rt cookie
```

Rules:
1. `newPassword` is checked against the **shared policy module** before anything else, so a weak
   password cannot spend an attempt: 400 `PASSWORD_TOO_WEAK` with `details.rules` naming every unmet
   rule, exactly like register and reset.
2. `currentPassword` is verified with argon2 against the stored hash. A miss is **401
   `INVALID_CREDENTIALS`** and nothing changes. An unverified or blocked account cannot reach this
   endpoint at all (`requireAuth` already rejects both).
3. Same password as the current one → **422 `SAME_PASSWORD`** (a new code), so the admin is told
   plainly instead of silently revoking their own sessions for nothing.
4. On success, in one transaction: write the new hash, set `passwordChangedAt = now`,
   `failedLoginCount = 0`, `lockedUntil = null`, and **revoke every refresh-token family of that user**.
5. **The caller stays signed in.** `passwordChangedAt` invalidates every access token issued at or
   before it (the `iat <= passwordChangedAt` rule in `middleware/auth.ts`), which is why the response
   must carry a freshly signed access token and a newly issued refresh cookie. The same reasoning is
   already written down for `acceptInvite`, which deliberately does *not* set `passwordChangedAt`.
6. Every other session is gone: their refresh tokens are revoked and
   `socketEmitter.disconnectUser(userId)` closes their live sockets, as `resetPassword` does.
7. `mailer.sendInBackground` sends the existing `password-changed` email in the user's locale.
8. Rate limit: the per-account limiter (`limitKey('login', 'email', …)`) is wrong here; use a new
   `changePassword:user:<id>` key, **5 attempts / 15 minutes**, answered 429 `RATE_LIMITED` with
   `Retry-After`. A wrong current password is an attempt; a successful change resets the key.
9. Never log either password (the redacting logger already covers `password` / `newPassword`).

Tests (named `AUTH-03` / `ADM-11`): weak new password → 400 with the unmet rules and no change; wrong
current password → 401 and no change; same password → 422; success → 200, the new password logs in,
the old one does not, the response's token works, another session's refresh token is rejected, the
socket of that other session is disconnected, and the email is queued; the rate limit after five
wrong attempts; `expectNoSecretKeys` on every response body.

**Storefront note (not in scope):** the endpoint is deliberately in `/auth`, not `/admin`, so the
customer account page can reuse it later (PROF-01) with no second implementation.

## 3. Admin — T-109: the two menu items

`AvatarMenu` gains two items above **Sign out**, both opening the existing `Modal`:

**Change password** (`routes/account-password-dialog.tsx`)
- Fields: current password, new password, confirm new password. The new-password field shows the live
  `PasswordRules` checklist that the invite screen already uses.
- Client-side: all three required; the new password must pass `isStrongPassword` (the shared copy);
  confirm must match; the new password must differ from the current one. Nothing is sent until those
  hold, so the server's attempt counter is not spent on typos.
- On success: close the dialog, store the returned session (`authStore.setSession`), re-prime the CSRF
  token, and show a toast that says the other sessions were signed out. The admin stays on the page.
- On failure: `INVALID_CREDENTIALS` is shown **on the current-password field** (not as a form error),
  `PASSWORD_TOO_WEAK` ticks the failing rules in the checklist, `SAME_PASSWORD` on the new-password
  field, `RATE_LIMITED` as the usual localized retry sentence.

**Profile** (`routes/account-profile-dialog.tsx`)
- Fields: first name, last name (1–40 each, trimmed), per `PATCH /me`. Email is shown read-only with
  a note that only another admin can change it (there is no endpoint, by design).
- Saves with `PATCH /me`, stores the returned user in the auth store so the avatar initials and the
  menu update at once, and shows a saved toast.
- The language toggle stays where it is (the top bar), so `preferredLocale` is not duplicated here.

Both dialogs: labelled fields, focus trapped by the existing `Modal`, `role="alert"` errors, RTL-safe
(logical properties only), and covered in en and ar.

## 4. New copy — needs approval before anything is built

| Key | en | ar |
| --- | --- | --- |
| `account.changePassword` | Change password | تغيير كلمة المرور |
| `account.profile` | Profile | الملف الشخصي |
| `account.current` | Current password | كلمة المرور الحالية |
| `account.new` | New password | كلمة المرور الجديدة |
| `account.confirm` | Confirm new password | تأكيد كلمة المرور الجديدة |
| `account.mismatch` | The two passwords do not match. | كلمتا المرور غير متطابقتين. |
| `account.sameAsCurrent` | Choose a password you have not used here before. | اختر كلمة مرور مختلفة عن الحالية. |
| `account.passwordSaved` | Password changed. You are still signed in here; other devices were signed out. | تم تغيير كلمة المرور. ما زلت مسجّلاً هنا، وتم تسجيل الخروج من الأجهزة الأخرى. |
| `account.profileSaved` | Profile saved. | تم حفظ الملف الشخصي. |
| `account.emailFixed` | Your email cannot be changed here. Ask another admin. | لا يمكن تغيير بريدك الإلكتروني من هنا. اطلب ذلك من مسؤول آخر. |
| `errors.SAME_PASSWORD` | Choose a password you have not used here before. | اختر كلمة مرور مختلفة عن الحالية. |

`auth.required`, `auth.invalidEmail`, `auth.passwordWeak`, `auth.rules.*`, `common.save`,
`common.cancel` and `errors.INVALID_CREDENTIALS` / `errors.RATE_LIMITED` are reused as they are.

## 5. Open question for the owner

An admin whose password is changed elsewhere is signed out of their other devices, which is the point
of the feature. Should the **other admins** be notified (ADM-10 notification) when an admin changes
their own password? The audit log already records admin actions on customers; self-service password
changes are not in it today. Nothing in the plan depends on the answer.

## 6. Sequence, once approved

1. Backend T-108: spec → code → tests → `node scripts/traceability.mjs` → changelog.
2. Admin T-109: copy added after approval → dialogs → tests (en + ar) → changelog.
3. Optional follow-up (not planned here): the same dialog on the storefront account page (PROF-01).
