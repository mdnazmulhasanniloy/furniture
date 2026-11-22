import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'test-revalidate-secret-0123456789abcdef';
vi.hoisted(() => {
  process.env.REVALIDATE_SECRET = 'test-revalidate-secret-0123456789abcdef';
  delete process.env.WEB_REVALIDATE_URL;
});

import { revalidateTags } from '../../src/lib/revalidate.js';

const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockClear();
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('ADM-06 · revalidation webhook (T-011)', () => {
  it('ADM-06 · posts {tags} to STOREFRONT_URL/api/revalidate with the shared secret header', async () => {
    await revalidateTags(['home', 'settings']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:3100/api/revalidate');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-revalidate-secret']).toBe(SECRET);
    expect(JSON.parse(String(init.body))).toEqual({ tags: ['home', 'settings'] });
  });

  it('ADM-06 · a rejected fetch and a non-2xx response are logged and never thrown', async () => {
    const log = { error: vi.fn() };
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(revalidateTags(['home'], { log, requestId: 'req-1' })).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(revalidateTags(['home'], { log, requestId: 'req-2' })).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('NFR-04 · the revalidation secret never appears in what is logged', async () => {
    const log = { error: vi.fn() };
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    await revalidateTags(['home'], { log, requestId: 'req-3' });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    await revalidateTags(['products'], { log, requestId: 'req-4' });
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(SECRET);
  });

  it('ADM-06 · a no-op when REVALIDATE_SECRET is unset (local dev): no request is sent', async () => {
    vi.resetModules();
    delete process.env.REVALIDATE_SECRET;
    const fresh = await import('../../src/lib/revalidate.js');
    await fresh.revalidateTags(['home']);
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.REVALIDATE_SECRET = SECRET;
    vi.resetModules();
  });
});
