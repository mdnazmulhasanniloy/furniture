/**
 * T-021 · ADM-14 / NFR-07 — the single pricing function: delivery fee, VAT, totals (ADR-009).
 *
 * Pure and I/O-free; used by cart (T-012) and orders (T-013). Callers pass the order
 * `lines` ({unitPrice, qty}), never a precomputed subtotal. All money values are integer
 * halalas and every money computation runs in BigInt — no floating-point arithmetic ever
 * touches money (`vatRate` is a rate, not money; its only use is `round(vatRate × 100)`
 * to basis points).
 *
 * Rules (ADR-009):
 * - deliveryFee = 0 when `freeDeliveryThreshold` is set and `subtotal >= threshold`,
 *   else the city override, else the base fee. The threshold compares against the
 *   subtotal of line prices AS STORED, which are VAT-inclusive when `pricesIncludeVat`
 *   is true.
 * - bp = round(vatRate × 100); base = subtotal + (applyToDelivery ? deliveryFee : 0).
 *   vatRate 0 → vatAmount 0. Inclusive: vatAmount = round(base·bp/(10000+bp)),
 *   total = subtotal + deliveryFee. Exclusive: vatAmount = round(base·bp/10000),
 *   total = subtotal + deliveryFee + vatAmount. Rounded half up, ONCE per order —
 *   per-line VAT is not computed; the `lines` output (`lineTotal` per line) is the
 *   hook for per-line ZATCA VAT if B-013 requires it.
 *
 * Invalid input is a programming error (the caller failed to validate), never a
 * user-facing response: it throws `PricingInputError`, which the central error
 * handler reports as 500 `INTERNAL_ERROR`.
 */

/** 500-class programming error: the caller passed unvalidated input. Not user-facing. */
export class PricingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingInputError';
  }
}

export interface PricingLine {
  /** Integer halalas, >= 0. */
  unitPrice: number;
  /** Positive integer. */
  qty: number;
}

export interface PricingLineResult extends PricingLine {
  /** unitPrice × qty, integer halalas. Hook for per-line ZATCA VAT (B-013). */
  lineTotal: number;
}

export interface PricingVatSetting {
  vatRate: number;
  applyToDelivery: boolean;
  pricesIncludeVat: boolean;
  registrationNumber?: string | null;
}

export interface PricingSettings {
  /** Base delivery fee, integer halalas (SiteSetting.deliveryFee, default 0). */
  deliveryFee: number;
  /** Integer halalas; null/undefined = no threshold (never free by subtotal). */
  freeDeliveryThreshold?: number | null;
  vat: PricingVatSetting;
}

export interface PricingCity {
  /** Integer halalas; null/undefined = use the base fee (DeliveryCity.deliveryFee). */
  deliveryFee?: number | null;
}

export interface PricingInput {
  lines: readonly PricingLine[];
  /** The resolved delivery city, or null/undefined when no address is selected yet. */
  city?: PricingCity | null;
  settings: PricingSettings;
}

export interface PricingResult {
  lines: PricingLineResult[];
  subtotal: number;
  deliveryFee: number;
  /** Shaped like the OrderVat snapshot (data-model.md) so orders can store it directly. */
  vat: {
    vatRate: number;
    vatAmount: number;
    applyToDelivery: boolean;
    pricesIncludeVat: boolean;
    registrationNumber: string | null;
  };
  total: number;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function assertMoneyInt(value: number | null | undefined, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new PricingInputError(
      `${name} must be a non-negative safe integer, got ${String(value)}`,
    );
  }
}

function toSafeNumber(value: bigint, name: string): number {
  if (value > MAX_SAFE) throw new PricingInputError(`${name} exceeds Number.MAX_SAFE_INTEGER`);
  return Number(value);
}

/** Exact half-up division of non-negative BigInts: round(num / den). */
const divHalfUp = (num: bigint, den: bigint): bigint => (2n * num + den) / (2n * den);

export function computePricing({ lines, city, settings }: PricingInput): PricingResult {
  assertMoneyInt(settings.deliveryFee, 'settings.deliveryFee');
  if (settings.freeDeliveryThreshold != null) {
    assertMoneyInt(settings.freeDeliveryThreshold, 'settings.freeDeliveryThreshold');
  }
  if (city?.deliveryFee != null) assertMoneyInt(city.deliveryFee, 'city.deliveryFee');
  const { vat } = settings;
  if (
    typeof vat.vatRate !== 'number' ||
    !Number.isFinite(vat.vatRate) ||
    vat.vatRate < 0 ||
    vat.vatRate > 50
  ) {
    throw new PricingInputError(`vat.vatRate must be between 0 and 50, got ${String(vat.vatRate)}`);
  }

  let subtotalBig = 0n;
  const outLines = lines.map((line, i) => {
    assertMoneyInt(line.unitPrice, `lines[${i}].unitPrice`);
    if (typeof line.qty !== 'number' || !Number.isSafeInteger(line.qty) || line.qty <= 0) {
      throw new PricingInputError(
        `lines[${i}].qty must be a positive safe integer, got ${String(line.qty)}`,
      );
    }
    const lineTotalBig = BigInt(line.unitPrice) * BigInt(line.qty);
    subtotalBig += lineTotalBig;
    return {
      unitPrice: line.unitPrice,
      qty: line.qty,
      lineTotal: toSafeNumber(lineTotalBig, `lines[${i}].lineTotal`),
    };
  });
  const subtotal = toSafeNumber(subtotalBig, 'subtotal');

  const threshold = settings.freeDeliveryThreshold ?? null;
  const deliveryFee =
    threshold !== null && subtotal >= threshold ? 0 : (city?.deliveryFee ?? settings.deliveryFee);

  const bp = BigInt(Math.round(vat.vatRate * 100)); // basis points — a rate, not money
  const baseBig = subtotalBig + (vat.applyToDelivery ? BigInt(deliveryFee) : 0n);
  const vatAmount =
    bp === 0n
      ? 0
      : toSafeNumber(
          vat.pricesIncludeVat
            ? divHalfUp(baseBig * bp, 10000n + bp)
            : divHalfUp(baseBig * bp, 10000n),
          'vatAmount',
        );
  const total = toSafeNumber(
    subtotalBig + BigInt(deliveryFee) + (bp > 0n && !vat.pricesIncludeVat ? BigInt(vatAmount) : 0n),
    'total',
  );

  return {
    lines: outLines,
    subtotal,
    deliveryFee,
    vat: {
      vatRate: vat.vatRate,
      vatAmount,
      applyToDelivery: vat.applyToDelivery,
      pricesIncludeVat: vat.pricesIncludeVat,
      registrationNumber: vat.registrationNumber ?? null,
    },
    total,
  };
}
