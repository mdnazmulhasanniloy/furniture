import type { IncomingMessage } from 'node:http';

export const ORIGINAL_PATH_PARAM = '__originalPath';

/**
 * T-026 / ADR-012 §1: Vercel's backend-framework routing invokes a function with `req.url` set to
 * the rewrite DESTINATION path (`/api/index`, `/api/socket-io`), not the requested path ("Internal
 * rewrites in backend framework projects now route requests using the rewritten destination
 * path"). Our `vercel.json` rewrites therefore carry the requested path in the `__originalPath`
 * destination query parameter, and this restores it (with the rest of the query) before the
 * request reaches Express or engine.io.
 *
 * It only acts when the URL's pathname IS the function path, so it is a no-op under local dev,
 * tests and the old routing behaviour, where `req.url` is already the requested path. A client
 * sending `__originalPath` itself gains nothing: the rewrite happens before any auth or routing
 * decision, so it is equivalent to requesting that path directly.
 */
export function restoreOriginalUrl(req: Pick<IncomingMessage, 'url'>, functionPath: string): void {
  const url = req.url ?? '';
  const q = url.indexOf('?');
  const pathname = q === -1 ? url : url.slice(0, q);
  if (pathname !== functionPath) return;

  const params = new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
  const original = params.get(ORIGINAL_PATH_PARAM);
  // A path, not a scheme-relative URL ("//host") — anything else is left untouched.
  if (!original || !original.startsWith('/') || original.startsWith('//')) return;

  params.delete(ORIGINAL_PATH_PARAM);
  const rest = params.toString();
  req.url = original + (rest ? `?${rest}` : '');
}
