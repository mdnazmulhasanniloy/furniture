import type { Locale, RefreshToken, User } from '@prisma/client';
import type { Request } from 'express';
import { getEnv } from '../../config/env.js';
import { assertAllowedOrigin, csrfTokenFor, isValidCsrf } from '../../lib/csrf.js';
import { socketEmitter } from '../../lib/emitter.js';
import { AppError } from '../../lib/errors.js';
import { dummyVerify, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { extendWindow, hit, limitKey, peek, resetKey } from '../../lib/rateLimit.js';
import {
  hashRefreshToken,
  issueRefreshToken,
  REFRESH_COOKIE,
  REFRESH_GRACE_SECONDS,
  revokeFamily,
  rotateRefreshToken,
  signAccessToken,
  UNREVOKED,
} from '../../lib/tokens.js';
import { authenticateBearer } from '../../middleware/auth.js';
import { sendOtpEmail } from './auth.service.js';
import {
  assertCanIssue,
  createOtp,
  findPendingByPassword,
  type PendingRegistration,
} from './otp.service.js';

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
      const code = await createOtp({
        email,
        purpose: 'VERIFY_EMAIL',
        pendingRegistration: pending,
      });
      await sendOtpEmail({
        email,
        template: 'otp-verify',
        code,
        firstName: pending!.firstName,
        locale: ctx.locale ?? pending!.preferredLocale,
      });
    } catch (err) {
      // Cooldown / hourly cap: do not send, and do not turn the response into a password oracle.
      if (!(err instanceof AppError && err.status === 429)) throw err;
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

/** AUTH-05. With the refresh cookie: CSRF-checked, revokes the whole session. Bearer-only: nothing to revoke. */
export async function logout(req: Request): Promise<void> {
  const row = await cookieSession(req);
  if (row) {
    await revokeFamily(row.familyId);
    return;
  }
  await authenticateBearer(req);
}
