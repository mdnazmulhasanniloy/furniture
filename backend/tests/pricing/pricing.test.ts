import { describe, expect, it } from 'vitest';

import {
  computePricing,
  PricingInputError,
  type PricingInput,
  type PricingLine,
} from '../../src/lib/pricing.js';

const L = (unitPrice: number, qty = 1): PricingLine => ({ unitPrice, qty });

const vat = (over: Partial<PricingInput['settings']['vat']> = {}) => ({
  vatRate: 0,
  applyToDelivery: true,
  pricesIncludeVat: true,
  registrationNumber: null,
  ...over,
});

const settings = (
  over: Partial<Omit<PricingInput['settings'], 'vat'>> = {},
  vatOver: Partial<PricingInput['settings']['vat']> = {},
): PricingInput['settings'] => ({
  deliveryFee: 0,
  freeDeliveryThreshold: null,
  vat: vat(vatOver),
  ...over,
});

describe('ADM-14 / NFR-07 · computePricing', () => {
  it('ADM-14 · all defaults -> fee 0, vatAmount 0, total = subtotal; lines carry lineTotal', () => {
    const r = computePricing({ lines: [L(5000, 2), L(2500)], city: null, settings: settings() });
    expect(r.lines).toEqual([
      { unitPrice: 5000, qty: 2, lineTotal: 10000 },
      { unitPrice: 2500, qty: 1, lineTotal: 2500 },
    ]);
    expect(r.subtotal).toBe(12500);
    expect(r.deliveryFee).toBe(0);
    expect(r.vat).toEqual({
      vatRate: 0,
      vatAmount: 0,
      applyToDelivery: true,
      pricesIncludeVat: true,
      registrationNumber: null,
    });
    expect(r.total).toBe(12500);
  });

  it('ADM-14 · empty lines -> subtotal 0 and total 0 with defaults (empty cart)', () => {
    const r = computePricing({ lines: [], city: null, settings: settings() });
    expect(r).toMatchObject({ lines: [], subtotal: 0, deliveryFee: 0, total: 0 });
  });

  it('ADM-14 · base fee applies when the city has no override', () => {
    const s = settings({ deliveryFee: 1500 });
    for (const city of [null, undefined, { deliveryFee: null }]) {
      const r = computePricing({ lines: [L(12500)], city, settings: s });
      expect(r.deliveryFee).toBe(1500);
      expect(r.total).toBe(14000);
    }
  });

  it('ADM-14 · city override beats the base fee (an explicit 0 override means free)', () => {
    const s = settings({ deliveryFee: 1500 });
    expect(
      computePricing({ lines: [L(12500)], city: { deliveryFee: 2000 }, settings: s }).deliveryFee,
    ).toBe(2000);
    expect(
      computePricing({ lines: [L(12500)], city: { deliveryFee: 0 }, settings: s }).deliveryFee,
    ).toBe(0);
  });

  it('ADM-14 · no override and no base fee -> fee 0', () => {
    const r = computePricing({
      lines: [L(12500)],
      city: { deliveryFee: null },
      settings: settings(),
    });
    expect(r.deliveryFee).toBe(0);
    expect(r.total).toBe(12500);
  });

  it('ADM-14 · threshold met (at or above) -> fee 0; below -> fee; threshold empty -> never free', () => {
    const s = settings({ deliveryFee: 1500, freeDeliveryThreshold: 12500 });
    expect(computePricing({ lines: [L(12500)], city: null, settings: s }).deliveryFee).toBe(0);
    expect(computePricing({ lines: [L(12499)], city: null, settings: s }).deliveryFee).toBe(1500);
    // The threshold also beats a city override.
    expect(
      computePricing({ lines: [L(12500)], city: { deliveryFee: 2000 }, settings: s }).deliveryFee,
    ).toBe(0);
    const noThreshold = settings({ deliveryFee: 1500, freeDeliveryThreshold: null });
    expect(
      computePricing({ lines: [L(100_000_000, 100)], city: null, settings: noThreshold })
        .deliveryFee,
    ).toBe(1500);
  });

  it('ADM-14 · vatRate 0 -> vatAmount 0 even with applyToDelivery on and a fee', () => {
    const r = computePricing({
      lines: [L(12500)],
      city: null,
      settings: settings({ deliveryFee: 2000 }, { vatRate: 0, applyToDelivery: true }),
    });
    expect(r.vat.vatAmount).toBe(0);
    expect(r.total).toBe(14500);
  });

  it('ADM-14 · applyToDelivery changes the VAT base only when vatRate > 0', () => {
    const mk = (vatRate: number, applyToDelivery: boolean) =>
      computePricing({
        lines: [L(10000)],
        city: null,
        settings: settings(
          { deliveryFee: 2000 },
          { vatRate, applyToDelivery, pricesIncludeVat: false },
        ),
      });
    expect(mk(15, true).vat.vatAmount).toBe(1800); // base 12000
    expect(mk(15, false).vat.vatAmount).toBe(1500); // base 10000
    expect(mk(0, true).vat.vatAmount).toBe(0);
    expect(mk(0, false).vat.vatAmount).toBe(0);
  });

  it('NFR-07 · inclusive and exclusive formulas round half up (15% on base 12500 -> 1630 / 1875)', () => {
    const inclusive = computePricing({
      lines: [L(12500)],
      city: null,
      settings: settings({}, { vatRate: 15, pricesIncludeVat: true }),
    });
    expect(inclusive.vat.vatAmount).toBe(1630); // round(12500·1500/11500) = round(1630.43…)
    expect(inclusive.total).toBe(12500);

    const exclusive = computePricing({
      lines: [L(12500)],
      city: null,
      settings: settings({}, { vatRate: 15, pricesIncludeVat: false }),
    });
    expect(exclusive.vat.vatAmount).toBe(1875); // round(12500·1500/10000)
    expect(exclusive.total).toBe(14375);

    // Exact .5 fractions round UP: exclusive 15% on 50 -> 7.5 -> 8; inclusive 20% on 3 -> 0.5 -> 1.
    expect(
      computePricing({
        lines: [L(50)],
        city: null,
        settings: settings({}, { vatRate: 15, pricesIncludeVat: false }),
      }).vat.vatAmount,
    ).toBe(8);
    expect(
      computePricing({
        lines: [L(3)],
        city: null,
        settings: settings({}, { vatRate: 20, pricesIncludeVat: true }),
      }).vat.vatAmount,
    ).toBe(1);
  });

  it('NFR-07 · exclusive total = subtotal + fee + vatAmount; every money output is an integer', () => {
    const r = computePricing({
      lines: [L(9999, 3), L(1)],
      city: { deliveryFee: 1750 },
      settings: settings({ deliveryFee: 9000 }, { vatRate: 15, pricesIncludeVat: false }),
    });
    expect(r.total).toBe(r.subtotal + r.deliveryFee + r.vat.vatAmount);
    for (const v of [
      r.subtotal,
      r.deliveryFee,
      r.vat.vatAmount,
      r.total,
      ...r.lines.map((l) => l.lineTotal),
    ]) {
      expect(Number.isSafeInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('ADM-14 · result is a snapshot: mutating the inputs afterwards does not change it', () => {
    const s = settings(
      { deliveryFee: 1500 },
      { vatRate: 15, registrationNumber: '311111111111113' },
    );
    const city = { deliveryFee: 2000 };
    const r = computePricing({ lines: [L(10000)], city, settings: s });
    s.vat.vatRate = 50;
    s.vat.registrationNumber = '333333333333333';
    s.deliveryFee = 99999;
    city.deliveryFee = 99999;
    expect(r.deliveryFee).toBe(2000);
    expect(r.vat.vatRate).toBe(15);
    expect(r.vat.registrationNumber).toBe('311111111111113');
  });
});

describe('NFR-07 · computePricing input validation (PricingInputError, 500-class)', () => {
  const ok = settings();
  const call = (input: PricingInput) => () => computePricing(input);

  it('NFR-07 · unitPrice must be a non-negative safe integer', () => {
    for (const unitPrice of [-1, 10.5, NaN, Infinity, 2 ** 53]) {
      expect(call({ lines: [{ unitPrice, qty: 1 }], city: null, settings: ok })).toThrow(
        PricingInputError,
      );
    }
    expect(call({ lines: [L(0)], city: null, settings: ok })).not.toThrow();
  });

  it('NFR-07 · qty must be a positive safe integer (0 throws)', () => {
    for (const qty of [0, -1, 1.5, NaN, 2 ** 53]) {
      expect(call({ lines: [{ unitPrice: 100, qty }], city: null, settings: ok })).toThrow(
        PricingInputError,
      );
    }
  });

  it('NFR-07 · negative or non-integer fee and threshold values throw', () => {
    expect(call({ lines: [L(1)], city: null, settings: settings({ deliveryFee: -1 }) })).toThrow(
      PricingInputError,
    );
    expect(call({ lines: [L(1)], city: null, settings: settings({ deliveryFee: 10.5 }) })).toThrow(
      PricingInputError,
    );
    expect(
      call({ lines: [L(1)], city: null, settings: settings({ freeDeliveryThreshold: -1 }) }),
    ).toThrow(PricingInputError);
    expect(
      call({ lines: [L(1)], city: null, settings: settings({ freeDeliveryThreshold: 0.5 }) }),
    ).toThrow(PricingInputError);
    expect(call({ lines: [L(1)], city: { deliveryFee: -5 }, settings: ok })).toThrow(
      PricingInputError,
    );
    expect(call({ lines: [L(1)], city: { deliveryFee: 1.5 }, settings: ok })).toThrow(
      PricingInputError,
    );
  });

  it('NFR-07 · vatRate outside 0-50 throws', () => {
    for (const vatRate of [-0.01, 50.01, NaN, Infinity]) {
      expect(call({ lines: [L(1)], city: null, settings: settings({}, { vatRate }) })).toThrow(
        PricingInputError,
      );
    }
    expect(
      call({ lines: [L(1)], city: null, settings: settings({}, { vatRate: 50 }) }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Property tests (NFR-07): seeded PRNG, 5000 cases each, no new dependencies.
// ---------------------------------------------------------------------------

/** mulberry32 — tiny seeded PRNG, deterministic across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Case = { input: PricingInput; bpRaw: number };

function genCase(
  rand: () => number,
  force: Partial<{ pricesIncludeVat: boolean; bpRaw: number }> = {},
): Case {
  const int = (max: number) => Math.floor(rand() * (max + 1));
  const nLines = 1 + int(3);
  const lines = Array.from({ length: nLines }, () => ({
    unitPrice: int(100_000_000),
    qty: 1 + int(99_999),
  }));
  const bpRaw = force.bpRaw ?? int(5000); // basis points: vatRate 0–50.00%, 2 decimals
  const city = ((p) =>
    p < 1 / 3 ? null : p < 2 / 3 ? { deliveryFee: null } : { deliveryFee: int(50_000) })(rand());
  return {
    bpRaw,
    input: {
      lines,
      city,
      settings: {
        deliveryFee: int(50_000),
        freeDeliveryThreshold: rand() < 0.5 ? null : int(2_000_000_000),
        vat: {
          vatRate: bpRaw / 100,
          applyToDelivery: rand() < 0.5,
          pricesIncludeVat: force.pricesIncludeVat ?? rand() < 0.5,
          registrationNumber: null,
        },
      },
    },
  };
}

/** Exact half-up rounding of num/den on BigInts, written independently of the production code. */
function refRoundHalfUp(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  return 2n * r >= den ? q + 1n : q;
}

/** Slow BigInt reference implementation of ADR-009. */
function reference({ input, bpRaw }: Case) {
  let subtotal = 0n;
  const lineTotals: bigint[] = [];
  for (const l of input.lines) {
    const t = BigInt(l.unitPrice) * BigInt(l.qty);
    lineTotals.push(t);
    subtotal += t;
  }
  const threshold = input.settings.freeDeliveryThreshold ?? null;
  const fee =
    threshold !== null && subtotal >= BigInt(threshold)
      ? 0n
      : BigInt(input.city?.deliveryFee ?? input.settings.deliveryFee);
  const bp = BigInt(bpRaw);
  const base = subtotal + (input.settings.vat.applyToDelivery ? fee : 0n);
  const vatAmount =
    bp === 0n
      ? 0n
      : input.settings.vat.pricesIncludeVat
        ? refRoundHalfUp(base * bp, 10000n + bp)
        : refRoundHalfUp(base * bp, 10000n);
  const total = subtotal + fee + (bp > 0n && !input.settings.vat.pricesIncludeVat ? vatAmount : 0n);
  return { lineTotals, subtotal, fee, vatAmount, base, total };
}

const CASES = 5000;
const fail = (i: number, c: Case, msg: string): never => {
  throw new Error(`case ${i} failed (${msg}): ${JSON.stringify(c.input)}`);
};

describe('NFR-07 · computePricing property tests (seeded, 5000 cases each)', () => {
  it('NFR-07 · property: every money output is an integer >= 0', () => {
    const rand = mulberry32(0xf0071);
    for (let i = 0; i < CASES; i++) {
      const c = genCase(rand);
      const r = computePricing(c.input);
      const values = [
        r.subtotal,
        r.deliveryFee,
        r.vat.vatAmount,
        r.total,
        ...r.lines.map((l) => l.lineTotal),
      ];
      for (const v of values) {
        if (!Number.isSafeInteger(v) || v < 0) fail(i, c, `non-integer or negative output ${v}`);
      }
    }
  });

  it('NFR-07 · property: inclusive -> total = subtotal + fee and vatAmount <= base', () => {
    const rand = mulberry32(0xf0072);
    for (let i = 0; i < CASES; i++) {
      const c = genCase(rand, { pricesIncludeVat: true });
      const r = computePricing(c.input);
      if (r.total !== r.subtotal + r.deliveryFee) fail(i, c, `total ${r.total}`);
      const base = r.subtotal + (c.input.settings.vat.applyToDelivery ? r.deliveryFee : 0);
      if (r.vat.vatAmount > base) fail(i, c, `vatAmount ${r.vat.vatAmount} > base ${base}`);
    }
  });

  it('NFR-07 · property: exclusive -> total = subtotal + fee + vatAmount', () => {
    const rand = mulberry32(0xf0073);
    for (let i = 0; i < CASES; i++) {
      const c = genCase(rand, { pricesIncludeVat: false });
      const r = computePricing(c.input);
      if (r.total !== r.subtotal + r.deliveryFee + r.vat.vatAmount) fail(i, c, `total ${r.total}`);
    }
  });

  it('NFR-07 · property: vatRate 0 -> vatAmount 0', () => {
    const rand = mulberry32(0xf0074);
    for (let i = 0; i < CASES; i++) {
      const c = genCase(rand, { bpRaw: 0 });
      const r = computePricing(c.input);
      if (r.vat.vatAmount !== 0) fail(i, c, `vatAmount ${r.vat.vatAmount}`);
      if (r.total !== r.subtotal + r.deliveryFee) fail(i, c, `total ${r.total}`);
    }
  });

  it('NFR-07 · property: matches the BigInt exact-half-up reference implementation', () => {
    const rand = mulberry32(0xf0075);
    for (let i = 0; i < CASES; i++) {
      const c = genCase(rand);
      const r = computePricing(c.input);
      const ref = reference(c);
      if (BigInt(r.subtotal) !== ref.subtotal)
        fail(i, c, `subtotal ${r.subtotal} != ${ref.subtotal}`);
      if (BigInt(r.deliveryFee) !== ref.fee) fail(i, c, `fee ${r.deliveryFee} != ${ref.fee}`);
      if (BigInt(r.vat.vatAmount) !== ref.vatAmount)
        fail(i, c, `vatAmount ${r.vat.vatAmount} != ${ref.vatAmount}`);
      if (BigInt(r.total) !== ref.total) fail(i, c, `total ${r.total} != ${ref.total}`);
      r.lines.forEach((l, j) => {
        if (BigInt(l.lineTotal) !== ref.lineTotals[j])
          fail(i, c, `lineTotal[${j}] ${l.lineTotal} != ${ref.lineTotals[j]}`);
      });
    }
  });
});
