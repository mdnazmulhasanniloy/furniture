# Admin account menu: Change password and Profile — plan (QA C5)

**Status: behaviour decided by the owner 2026-11-25; the copy in section 4 is waiting for approval.
No code has been written for this, and none will be until the copy is approved.**
Asked for in the QA batch of 2026-11-24 (item C5): the admin account menu needs "Change password"
(current password required, the shared password policy, revoke other sessions) and "Profile" (name).

**Owner decisions, 2026-11-25:**
1. Require the current password, and **count a wrong one toward the existing login lockout**.
2. Apply the shared password policy to the new password.
3. Refuse a new password equal to the current one.
4. Revoke all other sessions; return a fresh access token and refresh cookie for this one.
5. **Do not** notify the other admins.
6. **Do** send a security email to the admin whose password changed, with the time and no secrets. If
   that email cannot be sent, the password change still succeeds and the failure is logged without
   details.

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
8. **Lockout (owner 2026-11-25): a wrong current password counts toward the existing login lockout.**
   The same key as sign-in, `login:email:<hmac>` (T-024), is hit on a failure and reset on success, so
   the five-failures-per-`LOGIN_LOCKOUT_SECONDS` rule covers both doors with one counter. While the
   email is locked the endpoint answers **429 `ACCOUNT_LOCKED`** with `Retry-After` **before** the
   password is checked, the same order as `login`, so it cannot become a password oracle either.
   **Consequence to keep in mind:** because that counter is per email, five wrong current-password
   attempts also lock *sign-in* for that admin until the window passes. That is the point of using one
   counter, but it is worth saying out loud.
9. **Security email (owner 2026-11-25).** A new template `admin-password-changed` (en + ar) is sent
   with `mailer.sendInBackground`, so a mail failure can never fail the change: the promise never
   rejects and a failure is logged by the mailer without the message data. It carries the first name
   and the change time (Asia/Riyadh, Western digits, Gregorian - the B-015 / ADR-008 convention used
   everywhere else) and **no secret of any kind**: no password, no token, no code, no IP, no device.
   The copy is in section 4. The existing `password-changed` template keeps serving customers (the
   endpoint picks by role), because its wording sends people to support rather than to the store owner.
   **No notification is sent to the other admins** (owner decision; ADM-10 is untouched).
10. Never log either password (the redacting logger already covers `password` / `newPassword`).

Tests (named `AUTH-03` / `ADM-11`): weak new password → 400 with the unmet rules and no change; wrong
current password → 401 and no change; same password → 422; success → 200, the new password logs in,
the old one does not, the response's token works, another session's refresh token is rejected, the
socket of that other session is disconnected, and the security email is queued with the time and no
secret in its body or subject; **five wrong current passwords → 429 `ACCOUNT_LOCKED`, and sign-in for
that email is locked too** (one counter), while a success resets it; **a transport failure on the email
leaves the change in place** (the password still works, the response is still 200) and logs nothing
about the message; `expectNoSecretKeys` on every response body.

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
- On failure: a 401 is shown **on the current-password field** with its own message
  (`account.currentWrong`) - the shared `errors.INVALID_CREDENTIALS` says "Incorrect email or
  password", and no email is involved here; `PASSWORD_TOO_WEAK` ticks the failing rules in the
  checklist; `SAME_PASSWORD` on the new-password field; **429 `ACCOUNT_LOCKED`** as the usual localized
  sentence plus the retry wait, with a note that this also pauses sign-in (one counter, per the owner's
  decision).

**Profile** (`routes/account-profile-dialog.tsx`)
- Fields: first name, last name (1–40 each, trimmed), per `PATCH /me`. Email is shown read-only with
  a note that only another admin can change it (there is no endpoint, by design).
- Saves with `PATCH /me`, stores the returned user in the auth store so the avatar initials and the
  menu update at once, and shows a saved toast.
- The language toggle stays where it is (the top bar), so `preferredLocale` is not duplicated here.

Both dialogs: labelled fields, focus trapped by the existing `Modal`, `role="alert"` errors, RTL-safe
(logical properties only), and covered in en and ar.

## 4. New copy — **waiting for approval** (nothing is built until it is approved)

### 4a. Admin UI — 11 new keys

| Key | en | ar |
| --- | --- | --- |
| `account.changePassword` | Change password | تغيير كلمة المرور |
| `account.profile` | Profile | الملف الشخصي |
| `account.current` | Current password | كلمة المرور الحالية |
| `account.confirm` | Confirm new password | تأكيد كلمة المرور الجديدة |
| `account.mismatch` | The two passwords do not match. | كلمتا المرور غير متطابقتين. |
| `account.currentWrong` | That is not your current password. | هذه ليست كلمة مرورك الحالية. |
| `account.sameAsCurrent` | Choose a password different from your current one. | اختر كلمة مرور مختلفة عن كلمة مرورك الحالية. |
| `account.passwordSaved` | Password changed. Other devices were signed out, and we sent you a confirmation email. | تم تغيير كلمة المرور. تم تسجيل الخروج من الأجهزة الأخرى، وأرسلنا إليك رسالة تأكيد بالبريد الإلكتروني. |
| `account.profileSaved` | Profile saved. | تم حفظ الملف الشخصي. |
| `account.emailFixed` | Your email cannot be changed here. Ask another admin. | لا يمكن تغيير بريدك الإلكتروني من هنا. اطلب ذلك من مسؤول آخر. |
| `errors.SAME_PASSWORD` | Choose a password different from your current one. | اختر كلمة مرور مختلفة عن كلمة مرورك الحالية. |

**Reused as they are, no new copy:** `auth.newPassword`, `auth.required`, `auth.rules.*` (the live
checklist), `auth.passwordWeak`, `admins.form.firstName`, `admins.form.lastName`, `common.save`,
`common.cancel`, `errors.ACCOUNT_LOCKED` (+ the existing retry phrase), `errors.RATE_LIMITED`,
`errors.VALIDATION_ERROR`.

### 4b. Security email — new template `admin-password-changed`

The template lives in `backend/src/emails/templates/{en,ar}/admin-password-changed.ts`, like the
others; these are not locale-JSON keys. `{firstName}` is the admin's first name and `{at}` is the
change time in Asia/Riyadh with Western digits and a Gregorian date, e.g. `25 Nov 2026, 14:32` /
`25 نوفمبر 2026، 14:32` (a small `formatRiyadhDateTime` helper in `emails/layout.ts`; no email prints a
time today). `Furnixa` is the shared `BRAND` constant, in both locales, as every template does until
B-006 is settled.

**Subject**

| | |
| --- | --- |
| en | Your Furnixa admin password was changed |
| ar | تم تغيير كلمة مرور حساب الإدارة في Furnixa |

**Body** (the same three lines in HTML and in the plain-text part)

| | |
| --- | --- |
| en | Hi {firstName},<br>Your Furnixa admin password was changed. If this wasn't you, contact the store owner right away.<br>When: {at} (Riyadh) |
| ar | مرحباً {firstName}،<br>تم تغيير كلمة مرور حسابك الإداري في Furnixa. إذا لم تكن أنت من قام بذلك، تواصل مع مالك المتجر فوراً.<br>الوقت: {at} (الرياض) |

The second line is the owner's sentence, kept word for word in English. Nothing else is in the email:
no password, no token, no code, no link, no IP address and no device description.

## 5. Answered by the owner (2026-11-25)

Should the other admins be notified when an admin changes their own password? **No.** The admin whose
password changed gets the security email in section 4b instead; ADM-10 notifications are untouched.

## 6. Sequence, once approved

0. **Owner approves the copy in section 4.** Nothing below starts before that.
1. Backend T-108: spec → endpoint + the `admin-password-changed` template → tests →
   `node scripts/traceability.mjs` → changelog.
2. Admin T-109: copy added → dialogs → tests (en + ar) → changelog.
3. Optional follow-up (not planned here): the same dialog on the storefront account page (PROF-01),
   reusing the endpoint; the customer keeps the existing `password-changed` email.
