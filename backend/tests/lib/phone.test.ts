import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';
import {
  normalizeSaudiContactPhone,
  normalizeSaudiPhone,
  SAUDI_CONTACT_PHONE_MAX_LENGTH,
  SAUDI_CONTACT_PHONE_PATTERN,
  SAUDI_PHONE_MAX_LENGTH,
  SAUDI_PHONE_PATTERN,
  saudiPhone,
} from '../../src/lib/phone.js';

const CANON = '+966551234567';

describe('NFR-06 · Saudi phone validator', () => {
  it.each(['0551234567', '551234567', '+966551234567', '00966551234567'])(
    'NFR-06 · accepts %s and normalizes to +966551234567',
    (input) => {
      expect(normalizeSaudiPhone(input)).toBe(CANON);
      expect(saudiPhone.parse(input)).toBe(CANON);
    },
  );

  it.each([
    '055 123 4567',
    '+966-55-123-4567',
    '٠٥٥١٢٣٤٥٦٧',
    '۰۵۵۱۲۳۴۵۶۷',
    '(055) 123.4567',
    '  0551234567  ',
  ])(
    'NFR-06 · normalises separators, whitespace and Arabic digits: %j -> +966551234567',
    (input) => {
      expect(normalizeSaudiPhone(input)).toBe(CANON);
    },
  );

  it('NFR-06 · mixed Arabic-Indic and ASCII digits normalise too', () => {
    expect(normalizeSaudiPhone('+966 ٥٥ 123 4567')).toBe(CANON);
  });

  it.each(['0112345678', '+966112345678', '0131234567', '+966 1 1234 5678'])(
    'NFR-06 · rejects landline %s',
    (input) => {
      expect(normalizeSaudiPhone(input)).toBeNull();
    },
  );

  it.each([
    '055123456',
    '05512345678',
    '+96655123456',
    '+9665512345678',
    '5512345',
    '966551234567',
    '+966+551234567',
    '0',
  ])('NFR-06 · rejects wrong length or shape %s', (input) => {
    expect(normalizeSaudiPhone(input)).toBeNull();
  });

  it.each([
    '05512345ab',
    'abcdefghij',
    '+966 55 123 45x7',
    '٠٥٥١٢٣٤٥٦a',
    '055١٢٣٤٥٦٧a',
    '٠٥٥ABC4567',
  ])('NFR-06 · rejects letters and mixed scripts left after normalisation: %j', (input) => {
    expect(normalizeSaudiPhone(input)).toBeNull();
  });

  it('NFR-06 · rejects non-digit characters that are not separators', () => {
    for (const input of [
      '055/123/4567',
      '055_1234567',
      '055#1234567',
      '0551234567\n0551234567',
      '055‎1234567',
    ]) {
      expect(normalizeSaudiPhone(input)).toBeNull();
    }
  });

  it('NFR-06 · rejects input over 25 characters before normalising', () => {
    const justOk = '0551234567'.padEnd(SAUDI_PHONE_MAX_LENGTH, ' '); // 25 chars, trims to a valid number
    expect(justOk).toHaveLength(25);
    expect(normalizeSaudiPhone(justOk)).toBe(CANON);
    const tooLong = '0551234567'.padEnd(SAUDI_PHONE_MAX_LENGTH + 1, ' '); // 26 chars, would be valid after trimming
    expect(normalizeSaudiPhone(tooLong)).toBeNull();
    expect(saudiPhone.safeParse(tooLong).success).toBe(false);
    expect(normalizeSaudiPhone('0'.repeat(1000))).toBeNull();
  });

  it.each([undefined, null, 0, 551234567, {}, [], true])(
    'NFR-06 · rejects non-string input %j',
    (input) => {
      expect(normalizeSaudiPhone(input)).toBeNull();
      expect(saudiPhone.safeParse(input).success).toBe(false);
    },
  );

  it('NFR-06 · rejects empty and blank input', () => {
    expect(normalizeSaudiPhone('')).toBeNull();
    expect(normalizeSaudiPhone('    ')).toBeNull();
  });

  it('NFR-06 · normalising an already-normalised number is idempotent', () => {
    expect(normalizeSaudiPhone(normalizeSaudiPhone('0551234567')!)).toBe(CANON);
    expect(CANON).toMatch(/^\+9665[0-9]{8}$/);
  });

  it('NFR-06 · the validator pattern equals x-canonical-pattern of SaudiPhoneInput in api-spec.yaml', () => {
    const spec = readFileSync(
      resolve(process.cwd(), '../project-docs/04-architecture/api-spec.yaml'),
      'utf8',
    );
    const block = spec.split(/^ {4}SaudiPhoneInput:\n/m)[1]!.split(/^ {4}\S/m)[0]!;
    const canonical = /x-canonical-pattern: '([^']+)'/.exec(block)?.[1];
    const maxLength = /maxLength: (\d+)/.exec(block)?.[1];
    expect(canonical).toBe(SAUDI_PHONE_PATTERN.source);
    expect(Number(maxLength)).toBe(SAUDI_PHONE_MAX_LENGTH);
  });

  it('NFR-06 · the contact-phone validator equals x-canonical-pattern of SaudiContactPhoneInput in api-spec.yaml', () => {
    const spec = readFileSync(
      resolve(process.cwd(), '../project-docs/04-architecture/api-spec.yaml'),
      'utf8',
    );
    const block = spec.split(/^ {4}SaudiContactPhoneInput:\n/m)[1]!.split(/^ {4}\S/m)[0]!;
    expect(/x-canonical-pattern: '([^']+)'/.exec(block)?.[1]).toBe(
      SAUDI_CONTACT_PHONE_PATTERN.source,
    );
    expect(Number(/maxLength: (\d+)/.exec(block)?.[1])).toBe(SAUDI_CONTACT_PHONE_MAX_LENGTH);
  });

  it('NFR-06 · the store contact phone takes a landline and a unified number as well as a mobile, and rejects anything else (B-033, owner 2026-11-24)', () => {
    expect(normalizeSaudiContactPhone('011 234 5678')).toBe('+966112345678');
    expect(normalizeSaudiContactPhone('0112345678')).toBe('+966112345678');
    expect(normalizeSaudiContactPhone('+966112345678')).toBe('+966112345678');
    expect(normalizeSaudiContactPhone('0551234567')).toBe('+966551234567');
    expect(normalizeSaudiContactPhone('٠٥٥١٢٣٤٥٦٧')).toBe('+966551234567');
    // unified numbers: 9200XXXXX (9 digits) and toll-free 800XXXXXXX (10)
    expect(normalizeSaudiContactPhone('9200 12345')).toBe('+966920012345');
    expect(normalizeSaudiContactPhone('800 123 4567')).toBe('+9668001234567');
    expect(normalizeSaudiContactPhone('+9668001234567')).toBe('+9668001234567');
    for (const bad of [
      '',
      '   ',
      'seed-phone',
      '+1 202 555 0147',
      '05512345',
      '0051234567',
      '011-234-567x',
      '0'.repeat(45),
      null,
      42,
    ]) {
      expect(normalizeSaudiContactPhone(bad), String(bad)).toBeNull();
    }
    // idempotent, so saving a loaded value again keeps it
    expect(normalizeSaudiContactPhone(normalizeSaudiContactPhone('011 234 5678')!)).toBe(
      '+966112345678',
    );
  });

  it('NFR-06 · an invalid phone is a zod issue on the phone path (-> 422 VALIDATION_ERROR through the error handler)', () => {
    const schema = z.object({ phone: saudiPhone });
    const r = schema.safeParse({ phone: '0112345678' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toBeInstanceOf(ZodError);
      expect(r.error.issues[0]!.path).toEqual(['phone']);
    }
    expect(schema.parse({ phone: '٠٥٥١٢٣٤٥٦٧' })).toEqual({ phone: CANON });
    expect(schema.safeParse({}).success).toBe(false);
  });
});
