import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { AppError } from './errors.js';
import { prisma } from './prisma.js';
import { notSet } from './prismaFilters.js';

export const REFRESH_COOKIE = 'fx_rt';
/** The refresh cookie is only sent to the auth routes. */
const REFRESH_COOKIE_PATH = '/api/v1/auth';
export const JWT_ISSUER = 'furnixa-api';
export const JWT_AUDIENCE = 'furnixa';
/** A just-rotated refresh token presented again within this window is a race, not a theft (T-005). */
export const REFRESH_GRACE_SECONDS = 10;

export function hmac(namespace: string, value: string): string {
  return createHmac('sha256', getEnv().REFRESH_TOKEN_PEPPER)
    .update(`${namespace}:${value}`)
    .digest('hex');
}

export const hashRefreshToken = (token: string) => hmac('refresh', token);

export function signAccessToken(user: { id: string; role: string }): string {
  const env = getEnv();
  return jwt.sign({ role: user.role }, env.ACCESS_TOKEN_SECRET, {
    algorithm: 'HS256',
    subject: user.id,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    jwtid: randomUUID(),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** HS256 only, `iss` and `aud` verified. Any failure -> 401 UNAUTHORIZED. */
export function verifyAccessToken(token: string): {
  sub: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
} {
  try {
    const p = jwt.verify(token, getEnv().ACCESS_TOKEN_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof p === 'string' || typeof p.sub !== 'string' || typeof p.jti !== 'string') {
      throw new Error('malformed claims');
    }
    if (typeof p.iat !== 'number' || typeof p.exp !== 'number') throw new Error('missing iat/exp');
    return { sub: p.sub, role: String(p.role), jti: p.jti, iat: p.iat, exp: p.exp };
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired access token');
  }
}

function cookieOptions(): CookieOptions {
  const env = getEnv();
  return {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: env.AUTH_COOKIE_SAME_SITE,
    domain: env.AUTH_COOKIE_DOMAIN,
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions(),
    maxAge: getEnv().REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

/** Null-or-missing (see prismaFilters.ts); rows are created with an explicit null, but be safe. */
export const UNREVOKED = notSet<Prisma.RefreshTokenWhereInput>('revokedAt');

const newToken = () => randomBytes(32).toString('base64url');

function tokenRow(
  userId: string,
  familyId: string,
  token: string,
  userAgent: string | undefined,
): Prisma.RefreshTokenUncheckedCreateInput {
  return {
    userId,
    familyId,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + getEnv().REFRESH_TOKEN_TTL_SECONDS * 1000),
    revokedAt: null,
    userAgent: userAgent?.slice(0, 255),
  };
}

/**
 * Starts a new session (new family). When the user would exceed MAX_ACTIVE_SESSIONS the oldest sessions'
 * families are revoked in the SAME transaction as creating the new token. Returns the raw token.
 */
export async function issueRefreshToken(userId: string, userAgent?: string): Promise<string> {
  const token = newToken();
  const familyId = randomUUID();
  const max = getEnv().MAX_ACTIVE_SESSIONS;
  // Concurrent logins of one user can conflict on the same old rows; the transaction re-reads, so retrying is safe.
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        const now = new Date();
        const active = await tx.refreshToken.findMany({
          where: { userId, ...UNREVOKED, expiresAt: { gt: now } },
          orderBy: { createdAt: 'asc' },
        });
        const excess = active.length + 1 - max;
        if (excess > 0) {
          const families = active.slice(0, excess).map((t) => t.familyId);
          await tx.refreshToken.updateMany({
            where: { userId, familyId: { in: families }, ...UNREVOKED },
            data: { revokedAt: now },
          });
        }
        await tx.refreshToken.create({ data: tokenRow(userId, familyId, token, userAgent) });
      });
      return token;
    } catch (err) {
      if (!isWriteConflict(err) || attempt >= 3) throw err;
    }
  }
}

/** Prisma P2034: a MongoDB transaction lost a write conflict with a concurrent one. */
const isWriteConflict = (e: unknown) => (e as { code?: string })?.code === 'P2034';

/**
 * Marks `old` rotated and creates its successor in the same family, atomically.
 * Undefined = lost the race: another request already rotated it (either its claim found the token
 * revoked, or its transaction conflicted with the winner's in-flight one).
 */
export async function rotateRefreshToken(
  old: { id: string; userId: string; familyId: string },
  userAgent?: string,
): Promise<string | undefined> {
  const token = newToken();
  try {
    const claimed = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const res = await tx.refreshToken.updateMany({
        where: { id: old.id, ...UNREVOKED },
        data: { revokedAt: now, rotatedAt: now },
      });
      if (res.count === 0) return false;
      await tx.refreshToken.create({ data: tokenRow(old.userId, old.familyId, token, userAgent) });
      return true;
    });
    return claimed ? token : undefined;
  } catch (err) {
    if (isWriteConflict(err)) return undefined;
    throw err;
  }
}

export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, ...UNREVOKED },
    data: { revokedAt: new Date() },
  });
}

/** Password reset and block only (T-006, T-017). */
export async function revokeAllForUser(
  userId: string,
  db: Pick<Prisma.TransactionClient, 'refreshToken'> = prisma,
): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, ...UNREVOKED },
    data: { revokedAt: new Date() },
  });
}
