// API errors (api-spec.yaml#Error). The API is English-only: `message` is for
// logs/developers and is never shown; the UI localises by `code` (CLAUDE.md rule 8).

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  /** Seconds from the `Retry-After` header (RATE_LIMITED / ACCOUNT_LOCKED). */
  readonly retryAfterSeconds?: number;
  /** Raw `details` of the error body (e.g. OUT_OF_STOCK `{items: [{productId, stock}]}`). */
  readonly details?: unknown;

  constructor(init: {
    status: number;
    code: string;
    message?: string;
    requestId?: string;
    retryAfterSeconds?: number;
    details?: unknown;
  }) {
    super(init.message ?? init.code);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.details = init.details;
  }
}

/** Codes that have a dedicated entry in messages/{en,ar}.json under `errors`. */
export const KNOWN_ERROR_CODES = [
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "ACCOUNT_LOCKED",
  "ACCOUNT_BLOCKED",
  "EMAIL_NOT_VERIFIED",
  "UNAUTHORIZED",
  "REFRESH_RACE",
  "CSRF_INVALID",
  "NETWORK_ERROR",
  "OTP_INVALID",
  "PASSWORD_TOO_WEAK",
  "OTP_EXPIRED",
  "EMAIL_IN_USE",
  "OUT_OF_STOCK",
  "CART_LIMIT_REACHED",
  "WISHLIST_LIMIT_REACHED",
  "WISHLIST_CONFLICT",
  "CART_CONFLICT",
  "NOT_FOUND",
  "PRICE_CHANGED",
  "OUT_OF_DELIVERY_AREA",
  "CART_EMPTY",
  "TOO_MANY_PENDING_ORDERS",
  "IDEMPOTENCY_MISMATCH",
  "CONFLICT",
  "VALIDATION_ERROR",
  "ADDRESS_LIMIT_REACHED",
  "INVALID_TRANSITION",
] as const;

export function errorMessageKey(code: string): string {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code) ? code : "generic";
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value.trim());
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Localised text for an error. `t` is the `errors` namespace translator.
 * For RATE_LIMITED / ACCOUNT_LOCKED the Retry-After wait is appended
 * ("Try again in 12 minutes").
 */
export function apiErrorMessage(t: Translate, error: unknown): string {
  const code = error instanceof ApiError ? error.code : "generic";
  const base = t(errorMessageKey(code));
  const wait = error instanceof ApiError ? error.retryAfterSeconds : undefined;
  if ((code === "RATE_LIMITED" || code === "ACCOUNT_LOCKED") && wait !== undefined) {
    const retry =
      wait < 60
        ? t("retrySeconds", { seconds: Math.max(1, wait) })
        : t("retryMinutes", { minutes: Math.ceil(wait / 60) });
    return `${base} ${retry}`;
  }
  return base;
}
