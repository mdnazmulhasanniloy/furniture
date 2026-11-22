import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { AppError } from '../../lib/errors.js';
import * as controller from './controller.js';

// Hashing both sides makes timingSafeEqual usable on inputs of different lengths.
const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

export const secretsEqual = (given: string, secret: string): boolean =>
  timingSafeEqual(digest(given), digest(secret));

/**
 * NFR-01/NFR-08 (ADR-012 §5): accepts `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron
 * sends) or `x-cron-secret: <CRON_SECRET>`; constant-time compare; anything else -> 401. A user
 * JWT never equals the secret, so it is rejected like any wrong value.
 */
export function cronAuth(secret: string): RequestHandler {
  return (req, _res, next) => {
    const bearer = /^Bearer\s+(.+)$/.exec(req.get('authorization') ?? '')?.[1];
    const given = bearer ?? req.get('x-cron-secret');
    if (!given || !secretsEqual(given, secret)) {
      next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
      return;
    }
    next();
  };
}

/** Mounted at `/internal/cron` (not under /api/v1) only when CRON_SECRET is set (T-025). */
export function createCronRouter(secret: string): Router {
  const router = Router();
  router.use(cronAuth(secret));
  router.get('/cleanup', controller.cleanup);
  router.post('/cleanup', controller.cleanup);
  return router;
}
