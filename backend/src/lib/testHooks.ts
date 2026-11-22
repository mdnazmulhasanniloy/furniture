/**
 * Guarded test-only hooks (owner 2026-11-22, T-013 hardening). Modules expose deterministic
 * interleaving points for concurrency tests (e.g. cart `beforeWrite`, orders `beforeTransaction`)
 * through this factory, which makes them inert outside tests:
 *
 * - SETTING a hook when `NODE_ENV !== 'test'` throws.
 * - READING a hook when `NODE_ENV !== 'test'` yields `undefined`, so every
 *   `await hooks.x?.()` call site is a no-op even if a hook was somehow set earlier.
 *
 * The hooks are plain module-level objects mutated only by test code that imports the module:
 * nothing maps HTTP input, headers, query strings or environment variables onto them.
 * `NODE_ENV` is read at every access (not captured at import) so flipping it in a test proves
 * the guard, and a production process can never enable hooks after start-up without also
 * failing every real code path that checks NODE_ENV.
 */
export function createTestHooks<T extends object>(): T {
  const store = new Map<PropertyKey, unknown>();
  const inTest = () => process.env.NODE_ENV === 'test';
  return new Proxy({} as T, {
    set(_target, prop, value) {
      if (!inTest()) {
        throw new Error(
          `test hooks can only be set when NODE_ENV === 'test' (attempted to set "${String(prop)}")`,
        );
      }
      store.set(prop, value);
      return true;
    },
    get(_target, prop) {
      if (!inTest()) return undefined;
      return store.get(prop);
    },
    has(_target, prop) {
      return inTest() && store.has(prop);
    },
    deleteProperty(_target, prop) {
      store.delete(prop);
      return true;
    },
  });
}
