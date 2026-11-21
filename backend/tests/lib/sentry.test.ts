import * as Sentry from '@sentry/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureException, initSentry, scrubEvent } from '../../src/lib/sentry.js';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((cb: (scope: { setTag: () => void }) => void) => cb({ setTag: vi.fn() })),
}));

afterEach(() => {
  vi.clearAllMocks();
  initSentry({ SENTRY_DSN: undefined, SENTRY_ENVIRONMENT: 'test' });
});

describe('sentry', () => {
  it('NFR-04 · Sentry is not initialised without SENTRY_DSN', () => {
    expect(initSentry({ SENTRY_DSN: undefined, SENTRY_ENVIRONMENT: 'test' })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
    captureException(new Error('x'));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('NFR-04 · Sentry is initialised when SENTRY_DSN is set and errors are captured', () => {
    const dsn = 'https://key@o0.ingest.sentry.io/1';
    expect(initSentry({ SENTRY_DSN: dsn, SENTRY_ENVIRONMENT: 'staging' })).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn,
      environment: 'staging',
      beforeSend: expect.any(Function),
    });
    captureException(new Error('x'), 'req-1');
    expect(Sentry.captureException).toHaveBeenCalledOnce();
  });

  it('NFR-04 · Sentry events carry no request headers, cookies or body; method and url stay', () => {
    initSentry({ SENTRY_DSN: 'https://key@o0.ingest.sentry.io/1', SENTRY_ENVIRONMENT: 'test' });
    const { beforeSend } = vi.mocked(Sentry.init).mock.calls[0]![0]!;

    const event = {
      type: undefined,
      message: 'boom',
      request: {
        method: 'POST',
        url: 'http://localhost:4100/api/v1/auth/login',
        headers: { authorization: 'Bearer eyJ.full.jwt', cookie: 'fx_rt=RAW', 'x-csrf-token': 'c' },
        cookies: { fx_rt: 'RAW' },
        data: { email: 'a@b.com', password: 'Sup3rSecret' },
      },
    } as unknown as Sentry.ErrorEvent;
    const out = beforeSend!(event, {}) as Sentry.ErrorEvent;

    expect(out.request).toEqual({
      method: 'POST',
      url: 'http://localhost:4100/api/v1/auth/login',
    });
    expect(JSON.stringify(out)).not.toMatch(/eyJ\.full\.jwt|RAW|Sup3rSecret/);
    // an event without a request is returned unchanged
    expect(scrubEvent({ message: 'x' } as Sentry.ErrorEvent)).toEqual({ message: 'x' });
  });
});
