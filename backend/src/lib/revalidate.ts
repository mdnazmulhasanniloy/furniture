import { getEnv } from '../config/env.js';
import { createLogger, type Logger } from './logger.js';

export interface RevalidateContext {
  log?: Pick<Logger, 'error'>;
  requestId?: string;
}

let fallbackLogger: Logger | undefined;
const TIMEOUT_MS = 5_000;

/**
 * Next.js on-demand revalidation (integrations.md, T-011; the no-op was added in T-010). POSTs `{tags}`
 * to `WEB_REVALIDATE_URL` (default `STOREFRONT_URL/api/revalidate`) with the shared secret in
 * `x-revalidate-secret`. Called after the write committed (via `finishAfterCommit`); it must never throw
 * or fail the request, so every failure is only logged. A no-op when `REVALIDATE_SECRET` is unset (local
 * dev without a storefront). The secret and the webhook response are never logged.
 */
export async function revalidateTags(tags: string[], ctx: RevalidateContext = {}): Promise<void> {
  const env = getEnv();
  if (!env.REVALIDATE_SECRET) return;
  const url = env.WEB_REVALIDATE_URL ?? `${env.STOREFRONT_URL.replace(/\/+$/, '')}/api/revalidate`;
  const log = ctx.log ?? (fallbackLogger ??= createLogger(env));
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-revalidate-secret': env.REVALIDATE_SECRET,
      },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log.error(
        { status: res.status, tags, requestId: ctx.requestId },
        'Revalidation webhook failed',
      );
    }
  } catch (err) {
    // Only the message: an error object could in principle echo request internals.
    log.error(
      { err: err instanceof Error ? err.message : String(err), tags, requestId: ctx.requestId },
      'Revalidation webhook unreachable',
    );
  }
}
