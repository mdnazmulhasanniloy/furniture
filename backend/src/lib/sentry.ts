import * as Sentry from '@sentry/node';
import type { Env } from '../config/env.js';

let enabled = false;

/** Initialises Sentry only when SENTRY_DSN is set. Returns whether it is active. */
export function initSentry(env: Pick<Env, 'SENTRY_DSN' | 'SENTRY_ENVIRONMENT'>): boolean {
  if (!env.SENTRY_DSN) {
    enabled = false;
    return false;
  }
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT });
  enabled = true;
  return true;
}

export function captureException(err: unknown, requestId?: string): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (requestId) scope.setTag('requestId', requestId);
    Sentry.captureException(err);
  });
}
