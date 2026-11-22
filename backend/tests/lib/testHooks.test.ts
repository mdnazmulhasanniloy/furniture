import { afterEach, describe, expect, it } from 'vitest';
import { testHooks as cartHooks } from '../../src/modules/cart/service.js';
import { testHooks as orderHooks } from '../../src/modules/orders/service.js';

/**
 * T-013 hardening (owner 2026-11-22): the deterministic-interleaving hooks the concurrency tests
 * use must be unreachable outside tests. They are module-level objects guarded by
 * `createTestHooks`; nothing maps HTTP input or env vars onto them, and outside NODE_ENV=test
 * they can neither be set nor read.
 */
describe('NFR-01 · guarded test hooks', () => {
  afterEach(() => {
    process.env.NODE_ENV = 'test';
    delete cartHooks.beforeWrite;
    delete orderHooks.beforeTransaction;
  });

  it('NFR-01 · test hooks are inert when NODE_ENV is not test', () => {
    // Set while in test mode (allowed) …
    cartHooks.beforeWrite = async () => {};
    orderHooks.beforeTransaction = async () => {};
    expect(cartHooks.beforeWrite).toBeTypeOf('function');
    expect(orderHooks.beforeTransaction).toBeTypeOf('function');

    for (const env of ['production', 'development']) {
      process.env.NODE_ENV = env;
      // … setting outside test mode throws …
      expect(() => {
        cartHooks.beforeWrite = async () => {};
      }).toThrow(/NODE_ENV === 'test'/);
      expect(() => {
        orderHooks.beforeTransaction = async () => {};
      }).toThrow(/NODE_ENV === 'test'/);
      // … and hooks set earlier read as undefined, so every `hooks.x?.()` call site is a no-op.
      expect(cartHooks.beforeWrite).toBeUndefined();
      expect(orderHooks.beforeTransaction).toBeUndefined();
      expect('beforeWrite' in cartHooks).toBe(false);
      expect('beforeTransaction' in orderHooks).toBe(false);
    }

    // Back in test mode the previously set hooks are visible again (the guard is read-time).
    process.env.NODE_ENV = 'test';
    expect(cartHooks.beforeWrite).toBeTypeOf('function');
    expect(orderHooks.beforeTransaction).toBeTypeOf('function');

    // Deleting is always allowed (clean-up must never be blocked).
    delete cartHooks.beforeWrite;
    delete orderHooks.beforeTransaction;
    expect(cartHooks.beforeWrite).toBeUndefined();
    expect(orderHooks.beforeTransaction).toBeUndefined();
  });
});
