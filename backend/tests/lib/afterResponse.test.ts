import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

import { waitUntil } from '@vercel/functions';
import { finishAfterCommit } from '../../src/lib/afterResponse.js';

const originalVercel = process.env.VERCEL;

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  vi.mocked(waitUntil).mockClear();
});

describe('finishAfterCommit (shared T-028/T-009 release pattern)', () => {
  it('ADM-03 · outside Vercel the release is awaited before the response is sent', async () => {
    delete process.env.VERCEL;
    const order: string[] = [];
    const release = vi.fn(async () => {
      // A real async boundary, so a non-awaited release would lose the race against send.
      await new Promise((r) => setTimeout(r, 10));
      order.push('release');
    });
    const send = vi.fn(() => order.push('send'));

    await finishAfterCommit(release, send);

    expect(order).toEqual(['release', 'send']);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('ADM-03 · on Vercel the response is sent first (not delayed) and waitUntil receives the release promise', async () => {
    process.env.VERCEL = '1';
    const order: string[] = [];
    let resolveRelease!: () => void;
    const pending = new Promise<void>((r) => {
      resolveRelease = () => {
        order.push('release');
        r();
      };
    });
    const release = vi.fn(() => pending);
    const send = vi.fn(() => order.push('send'));

    await finishAfterCommit(release, send);

    // The response went out although the release has not resolved yet: it was not delayed.
    expect(order).toEqual(['send']);
    expect(release).toHaveBeenCalledOnce();
    // waitUntil got exactly the promise release() returned, so Vercel keeps the function alive for it.
    expect(waitUntil).toHaveBeenCalledExactlyOnceWith(pending);

    resolveRelease();
    await pending;
    expect(order).toEqual(['send', 'release']);
  });
});
