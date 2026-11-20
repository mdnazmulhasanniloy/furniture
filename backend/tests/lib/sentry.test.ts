import * as Sentry from '@sentry/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureException, initSentry } from '../../src/lib/sentry.js';

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
    expect(Sentry.init).toHaveBeenCalledWith({ dsn, environment: 'staging' });
    captureException(new Error('x'), 'req-1');
    expect(Sentry.captureException).toHaveBeenCalledOnce();
  });
});
