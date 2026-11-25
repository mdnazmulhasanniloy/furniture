import type { Locale, RefreshToken, User } from '@prisma/client';
import type { Request } from 'express';
import { getEnv } from '../../config/env.js';
import { assertAllowedOrigin, csrfTokenFor, isValidCsrf } from '../../lib/csrf.js';
import { socketEmitter } from '../../lib/emitter.js';
import { AppError } from '../../lib/errors.js';
import { mailer } from '../../emails/mailer.js';
import {
  assertStrongPassword,
  dummyVerify,
  hashPassword,
  verifyPassword,
} from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { extendWindow, hit, limitKey, peek, resetKey } from '../../lib/rateLimit.js';
import {
  hashRefreshToken,
  issueRefreshToken,
  REFRESH_COOKIE,
  REFRESH_GRACE_SECONDS,
  revokeAllForUser,
  revokeFamily,
  rotateRefreshToken,
  signAccessToken,
  UNREVOKED,
} from '../../lib/tokens.js';
import { authenticateBearer } from '../../middleware/auth.js';
import { issueAndSendOtp } from './auth.service.js';
import { assertCanIssue, findPendingByPassword, type PendingRegistration } from './otp.service.js';
import type { ChangePasswordBody } from './schema.js';

interface Ctx {
  userAgent?: string;
  requestId?: string;
  locale?: Locale;
}

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

/** A failed attempt: count it on the email key (single source of truth for the lockout), mirror it on the user, reply generically. */
async function failLogin(user: User | null, key: string, ctx: Ctx): Promise<never> {
  const env = getEnv();
  const now = new Date();
  const r = await hit(key, env.LOGIN_MAX_FAILURES, env.LOGIN_LOCKOUT_SECONDS, {
    requestId: ctx.requestId,
    now,
  });
  const locked = !r.failedOpen && r.hits >= env.LOGIN_MAX_FAILURES;
  if (locked) {
    // The lockout lasts LOGIN_LOCKOUT_SECONDS from the failure that reached the limit.
    await extendWindow(key, env.LOGIN_LOCKOUT_SECONDS, { requestId: ctx.requestId, now });
  }
  if (user) {
    await prisma.user
      .update({
        where: { id: user.id },
        data: {
          failedLoginCount: { increment: 1 }, // atomic, never read-then-write
          ...(locked
            ? { lockedUntil: new Date(now.getTime() + env.LOGIN_LOCKOUT_SECONDS * 1000) }
            : {}),
        },
      })
      .catch(() => undefined); // the mirror must never change the response
  }
  throw invalidCredentials();
}

/**
 * AUTH-02. Order: (IP limiter in the route) -> email lockout -> password -> status checks.
 * While locked every attempt gets 429 without touching the password, for known and unknown emails alike.
 */
export async function login(email: string, password: string, ctx: Ctx) {
  const env = getEnv();
  const key = limitKey('login', 'email', email);

  const lock = await peek(key, env.LOGIN_MAX_FAILURES, { requestId: ctx.requestId });
  if (lock.locked) {
    throw new AppError(
      429,
      'ACCOUNT_LOCKED',
      'Too many failed logins; account temporarily locked',
      {
        retryAfterSeconds: lock.retryAfterSeconds,
      },
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await dummyVerify(password);
    return failLogin(null, key, ctx);
  }

  // An unverified account's password lives on its pending registrations (T-027), not on the user row.
  let pending: PendingRegistration | undefined;
  let passwordOk: boolean;
  if (user.isVerified) {
    passwordOk = await verifyPassword(user.passwordHash, password);
  } else {
    pending = await findPendingByPassword(email, password);
    passwordOk = pending !== undefined;
  }
  if (!passwordOk) return failLogin(user, key, ctx);

  // Only now, with a proven password, may the account status be revealed.
  if (user.isBlocked) throw new AppError(403, 'ACCOUNT_BLOCKED', 'Account blocked');
  if (!user.isVerified) {
    try {
      await assertCanIssue(email, 'VERIFY_EMAIL');
      await issueAndSendOtp({
        email,
        purpose: 'VERIFY_EMAIL',
        template: 'otp-verify',
        firstName: pending!.firstName,
        locale: ctx.locale ?? pending!.preferredLocale,
        pendingRegistration: pending,
      });
    } catch (err) {
      // Cooldown / hourly cap (429), or a mail that could not be sent at all (503, owner 2026-11-24):
      // no code goes out, and the answer stays the same so it cannot become a password oracle.
      const expected = err instanceof AppError && (err.status === 429 || err.status === 503);
      if (!expected) throw err;
    }
    throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Email not verified; a new code was sent');
  }

  await resetKey(key, { requestId: ctx.requestId });
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  const refreshToken = await issueRefreshToken(user.id, ctx.userAgent);
  return { user: updated, accessToken: signAccessToken(updated), refreshToken };
}

/** Cookie-authenticated requests: Origin rule, then the cookie's row, then the CSRF token bound to its family. */
async function cookieSession(req: Request): Promise<RefreshToken | undefined> {
  const raw: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof raw !== 'string' || raw === '') return undefined;
  assertAllowedOrigin(req);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(raw) } });
  if (!row) return undefined;
  if (!isValidCsrf(row.familyId, req.get('x-csrf-token'))) {
    throw new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token');
  }
  return row;
}

/** GET /auth/csrf: needs a live refresh cookie; the token is bound to its session family. */
export async function issueCsrf(req: Request): Promise<string> {
  const raw: unknown = req.cookies?.[REFRESH_COOKIE];
  const row =
    typeof raw === 'string' && raw !== ''
      ? await prisma.refreshToken.findFirst({
          where: { tokenHash: hashRefreshToken(raw), ...UNREVOKED, expiresAt: { gt: new Date() } },
        })
      : null;
  if (!row) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  return csrfTokenFor(row.familyId);
}

/** AUTH-05. Rotation with a 10 s grace window and family-wide reuse detection. */
export async function refresh(req: Request) {
  const row = await cookieSession(req);
  if (!row) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');

  const now = Date.now();
  if (row.revokedAt) {
    if (row.rotatedAt) {
      if (now - row.rotatedAt.getTime() <= REFRESH_GRACE_SECONDS * 1000) {
        throw new AppError(
          401,
          'REFRESH_RACE',
          'Token was just rotated; retry with the new cookie',
        );
      }
      await revokeFamily(row.familyId); // reuse of a rotated token after the window: assume theft
      socketEmitter.disconnectUser(row.userId); // and close the (possibly stolen) live sockets (T-023)
    }
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  if (row.expiresAt.getTime() <= now) throw new AppError(401, 'UNAUTHORIZED', 'Session expired');

  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || user.isBlocked || !user.isVerified) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  const refreshToken = await rotateRefreshToken(row, req.get('user-agent'));
  if (!refreshToken) {
    throw new AppError(401, 'REFRESH_RACE', 'Token was just rotated; retry with the new cookie');
  }
  return { user, accessToken: signAccessToken(user), refreshToken };
}

/**
 * T-108 (QA C5, owner 2026-11-25). A signed-in user changes their own password.
 *
 * Order is the same no-oracle order as `login`, and the lockout is the SAME counter as sign-in
 * (`login:email:<hmac>`), by the owner's decision: five wrong current passwords lock this endpoint
 * *and* sign-in for that email until the window passes.
 *  1. the policy on the new password first, so a typo there spends no attempt;
 *  2. the lockout, before the current password is looked at;
 *  3. the current password, a miss counting toward that lockout;
 *  4. a new password equal to the current one -> 422, nothing written, no attempt spent.
 *
 * On success every refresh family is revoked and the other devices' sockets are closed, while this
 * caller stays signed in: `passwordChangedAt` kills every access token issued up to now (1 s
 * granularity), so the fresh one is stamped a second ahead - see `signAccessToken`. The security
 * email goes out in the background, so a transport failure can never fail the change.
 */
export async function changePassword(user: User, body: ChangePasswordBody, ctx: Ctx) {
  const env = getEnv();
  assertStrongPassword(body.newPassword);

  const key = limitKey('login', 'email', user.email);
  const lock = await peek(key, env.LOGIN_MAX_FAILURES, { requestId: ctx.requestId });
  if (lock.locked) {
    throw new AppError(
      429,
      'ACCOUNT_LOCKED',
      'Too many failed attempts; account temporarily locked',
      {
        retryAfterSeconds: lock.retryAfterSeconds,
      },
    );
  }

  if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
    return failLogin(user, key, ctx);
  }
  if (await verifyPassword(user.passwordHash, body.newPassword)) {
    throw new AppError(422, 'SAME_PASSWORD', 'The new password is the current one');
  }

  const passwordHash = await hashPassword(body.newPassword);
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null },
    });
    await revokeAllForUser(user.id, tx);
    return row;
  });
  await resetKey(key, { requestId: ctx.requestId });

  // The revoked sessions' live sockets go too (T-023). Best effort: a failed emit is logged, never thrown.
  socketEmitter.disconnectUser(user.id);

  // Owner 2026-11-25: the admin who changed it is told; the other admins are not notified.
  void mailer.sendInBackground(
    updated.role === 'ADMIN'
      ? {
          to: updated.email,
          template: 'admin-password-changed',
          locale: updated.preferredLocale,
          data: { firstName: updated.firstName, at: now },
        }
      : {
          to: updated.email,
          template: 'password-changed',
          locale: updated.preferredLocale,
          data: { firstName: updated.firstName },
        },
  );

  const refreshToken = await issueRefreshToken(updated.id, ctx.userAgent);
  return {
    user: updated,
    // One second ahead of `passwordChangedAt`, or this very response would be rejected.
    accessToken: signAccessToken(updated, { issuedAt: new Date(now.getTime() + 1000) }),
    refreshToken,
  };
}

/** AUTH-05. With the refresh cookie: CSRF-checked, revokes the whole session. Bearer-only: nothing to revoke. */
export async function logout(req: Request): Promise<void> {
  const row = await cookieSession(req);
  if (row) {
    await revokeFamily(row.familyId);
    return;
  }
  await authenticateBearer(req);
}
