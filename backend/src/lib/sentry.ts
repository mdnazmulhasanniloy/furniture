import * as Sentry from '@sentry/node';
import type { Env } from '../config/env.js';

let enabled = false;

/**
 * NFR-04: no PII or secrets in Sentry events. Request headers (authorization, cookie, x-csrf-token),
 * cookies and the request body are removed before an event leaves the process; method and URL stay.
 */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
  }
  return event;
}

/** Initialises Sentry only when SENTRY_DSN is set. Returns whether it is active. */
export function initSentry(env: Pick<Env, 'SENTRY_DSN' | 'SENTRY_ENVIRONMENT'>): boolean {
  if (!env.SENTRY_DSN) {
    enabled = false;
    return false;
  }
  // `sendDefaultPii` does not exist in the installed @sentry/node (11.16.0: absent from its types and code),
  // so it cannot be set; `beforeSend` is what guarantees no request data leaves the process.
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    beforeSend: scrubEvent,
  });
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
