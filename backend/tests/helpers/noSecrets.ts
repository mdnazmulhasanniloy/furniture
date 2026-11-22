import { expect } from 'vitest';

/**
 * Keys that must never appear anywhere in a response JSON (T-017, owner 2026-11-22):
 * password hashes, OTP data, pending registrations, and the admin-only lockout mirror.
 */
const FORBIDDEN_KEYS = [
  'passwordHash',
  'codeHash',
  'pendingRegistration',
  'failedLoginCount',
  'lockedUntil',
];

/** Recursively asserts that no forbidden key appears in the (parsed) response body. */
export function expectNoSecretKeys(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => expectNoSecretKeys(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      expect(FORBIDDEN_KEYS, `forbidden key "${k}" at ${path}`).not.toContain(k);
      expectNoSecretKeys(v, `${path}.${k}`);
    }
  }
}
