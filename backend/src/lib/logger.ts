import { pino, type DestinationStream } from 'pino';
import type { Env } from '../config/env.js';

export const REDACT_CENSOR = '[REDACTED]';

/**
 * NFR-04. Credentials must never reach a log line. Applied by pino itself, so it covers every logger built
 * by `createLogger` (pino-http request/response lines, the error handler, the mailer, the rate limiter).
 * `*.x` matches one level below the root (`req.x`, `err.x`, `user.x`); the bare names cover the root.
 * Note: `*.code` also hides `err.code` (e.g. Prisma P2034); the error `message` and stack stay visible.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  ...[
    'password',
    'newPassword',
    'code',
    'token',
    'accessToken',
    'refreshToken',
    'uploadUrl', // presigned R2 URL (T-008): carries a signature
  ].flatMap((k) => [k, `*.${k}`]),
];

/** `destination` is for tests that need to capture real output (the test environment logs nothing). */
export function createLogger(
  env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>,
  destination?: DestinationStream,
) {
  return pino(
    {
      level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
    },
    destination,
  );
}
export type Logger = ReturnType<typeof createLogger>;
