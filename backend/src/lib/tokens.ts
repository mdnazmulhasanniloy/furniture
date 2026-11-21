import { createHmac, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { prisma } from './prisma.js';

export const REFRESH_COOKIE = 'fx_rt';
/** The refresh cookie is only sent to the auth routes. */
const REFRESH_COOKIE_PATH = '/api/v1/auth';

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
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
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

/** Creates a refresh token row (only the keyed hash is stored) and returns the raw token. */
export async function issueRefreshToken(userId: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + getEnv().REFRESH_TOKEN_TTL_SECONDS * 1000),
      userAgent: userAgent?.slice(0, 255),
    },
  });
  return token;
}
