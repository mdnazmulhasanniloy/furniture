import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/lib/errors.js';
import { assertStrongPassword } from '../../src/lib/password.js';
import {
  PASSWORD_RULES,
  failedPasswordRules,
  isStrongPassword,
  passwordRuleStates,
} from '../../src/lib/passwordPolicy.js';

// Owner 2026-11-24: at least 8 characters, one uppercase, one lowercase, one digit, one special character.
// Reference regex: ^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d\s]).{8,}$
const OK = 'Furnixa#9a';

describe('AUTH-03 · password policy', () => {
  it('AUTH-03 · accepts a password that meets every rule', () => {
    expect(failedPasswordRules(OK)).toEqual([]);
    expect(isStrongPassword(OK)).toBe(true);
    expect(() => assertStrongPassword(OK)).not.toThrow();
    expect(passwordRuleStates(OK).every((r) => r.met)).toBe(true);
  });

  it('AUTH-03 · agrees with the reference regex on a spread of candidates', () => {
    const reference = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d\s]).{8,}$/;
    const candidates = [
      OK,
      'Short1!',
      'alllower1!',
      'ALLUPPER1!',
      'NoDigits!!',
      'NoSymbol12',
      'With Space 1A!',
      'ضغطكلمة1A!',
      'Aa1!Aa1!',
    ];
    for (const c of candidates) {
      expect(isStrongPassword(c), `${c}`).toBe(reference.test(c));
    }
  });

  // one failing case per rule
  const cases: { rule: (typeof PASSWORD_RULES)[number]; value: string }[] = [
    { rule: 'length', value: 'Furn#9a' }, // 7 characters
    { rule: 'upper', value: 'furnixa#9a' },
    { rule: 'lower', value: 'FURNIXA#9A' },
    { rule: 'digit', value: 'FurnixaPass#' },
    { rule: 'symbol', value: 'FurnixaPass9' },
  ];
  for (const { rule, value } of cases) {
    it(`AUTH-03 · rejects a password that fails the "${rule}" rule, and names only that rule`, () => {
      expect(failedPasswordRules(value)).toEqual([rule]);
      expect(isStrongPassword(value)).toBe(false);
      const err = (() => {
        try {
          assertStrongPassword(value);
          return null;
        } catch (e) {
          return e as AppError;
        }
      })();
      expect(err).toBeInstanceOf(AppError);
      expect(err?.status).toBe(400);
      expect(err?.code).toBe('PASSWORD_TOO_WEAK');
      expect(err?.details).toEqual({ rules: [rule] });
      expect(passwordRuleStates(value).find((r) => r.rule === rule)?.met).toBe(false);
    });
  }

  it('AUTH-03 · names every unmet rule, in display order', () => {
    expect(failedPasswordRules('abc')).toEqual(['length', 'upper', 'digit', 'symbol']);
    expect(failedPasswordRules('')).toEqual(PASSWORD_RULES.slice());
  });

  it('AUTH-03 · the 128-character API ceiling is part of the length rule', () => {
    expect(isStrongPassword(`Aa1!${'x'.repeat(124)}`)).toBe(true); // exactly 128
    expect(failedPasswordRules(`Aa1!${'x'.repeat(125)}`)).toEqual(['length']); // 129
  });
});
