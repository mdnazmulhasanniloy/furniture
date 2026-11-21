import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { getEnv } from '../config/env.js';
import { AppError } from './errors.js';

/** CSRF token = HMAC(CSRF_SECRET, familyId): bound to the session, so it survives refresh rotations. */
export function csrfTokenFor(familyId: string): string {
  return createHmac('sha256', getEnv().CSRF_SECRET).update(`csrf:${familyId}`).digest('base64url');
}

export function isValidCsrf(familyId: string, presented: string | undefined): boolean {
  if (!presented) return false;
  const a = Buffer.from(csrfTokenFor(familyId));
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cookie-authenticated requests with an Origin header must come from an allow-listed origin. */
export function assertAllowedOrigin(req: Request): void {
  const origin = req.get('origin');
  if (origin && !getEnv().CORS_ALLOWED_ORIGINS.includes(origin)) {
    throw new AppError(403, 'CSRF_INVALID', 'Origin not allowed');
  }
}
