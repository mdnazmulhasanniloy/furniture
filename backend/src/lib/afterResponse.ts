import { waitUntil } from '@vercel/functions';

/**
 * Runs an R2 `release()` strictly AFTER the caller's transaction committed, around sending the response
 * (T-028/T-009 pattern; T-010/T-011 use it too). Outside Vercel the release (which never throws) is awaited
 * BEFORE `send`: deterministic for callers and tests. On Vercel the response goes first and `waitUntil`
 * keeps the function alive for the cleanup.
 */
export async function finishAfterCommit(
  release: () => Promise<void>,
  send: () => void,
): Promise<void> {
  if (process.env.VERCEL) {
    send();
    waitUntil(release());
  } else {
    await release();
    send();
  }
}
