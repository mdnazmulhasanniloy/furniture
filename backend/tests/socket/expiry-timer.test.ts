import { describe, expect, it, vi } from 'vitest';
import { armExpiryTimer, MAX_TIMEOUT_MS } from '../../src/lib/socketServer.js';

/**
 * The socket expiry timer (T-023, NOTIF-01). Node holds a timer delay in a 32-bit signed integer
 * and silently clamps anything larger to 1 ms, so an access-token TTL beyond ~24.8 days used to
 * disconnect the socket on connect instead of at expiry. These lock the slicing behaviour.
 */
describe('armExpiryTimer (T-023)', () => {
  it('NOTIF-01 · a deadline past the 32-bit ceiling fires only after the whole delay', () => {
    vi.useFakeTimers();
    try {
      const onExpiry = vi.fn();
      armExpiryTimer(onExpiry, MAX_TIMEOUT_MS * 2 + 5_000);

      vi.advanceTimersByTime(MAX_TIMEOUT_MS);
      expect(onExpiry).not.toHaveBeenCalled();
      vi.advanceTimersByTime(MAX_TIMEOUT_MS);
      expect(onExpiry).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4_999);
      expect(onExpiry).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onExpiry).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('NOTIF-01 · a 30-day TTL does not fire early (the exact overflow that broke every socket)', () => {
    vi.useFakeTimers();
    try {
      const onExpiry = vi.fn();
      const thirtyDaysMs = 2_592_000 * 1000;
      expect(thirtyDaysMs).toBeGreaterThan(MAX_TIMEOUT_MS); // the precondition being guarded
      armExpiryTimer(onExpiry, thirtyDaysMs);

      vi.advanceTimersByTime(1_000);
      expect(onExpiry).not.toHaveBeenCalled();

      vi.advanceTimersByTime(thirtyDaysMs - 1_000);
      expect(onExpiry).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('NOTIF-01 · a delay inside the ceiling fires once, at the deadline', () => {
    vi.useFakeTimers();
    try {
      const onExpiry = vi.fn();
      armExpiryTimer(onExpiry, 900_000); // the documented ACCESS_TOKEN_TTL_SECONDS

      vi.advanceTimersByTime(899_999);
      expect(onExpiry).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onExpiry).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(MAX_TIMEOUT_MS);
      expect(onExpiry).toHaveBeenCalledTimes(1); // never re-fires
    } finally {
      vi.useRealTimers();
    }
  });

  it('NOTIF-01 · cancel() stops a sliced timer before it fires', () => {
    vi.useFakeTimers();
    try {
      const onExpiry = vi.fn();
      const timer = armExpiryTimer(onExpiry, MAX_TIMEOUT_MS * 3);

      vi.advanceTimersByTime(MAX_TIMEOUT_MS);
      timer.cancel();
      vi.advanceTimersByTime(MAX_TIMEOUT_MS * 3);
      expect(onExpiry).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('NOTIF-01 · a deadline already in the past fires promptly, never with a negative delay', () => {
    vi.useFakeTimers();
    try {
      const onExpiry = vi.fn();
      armExpiryTimer(onExpiry, -60_000);

      vi.advanceTimersByTime(0);
      expect(onExpiry).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
