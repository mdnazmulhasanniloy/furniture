// API errors (api-spec.yaml#Error). The API is English-only: `message` is for logs
// and is never shown; the UI localises by `code` (CLAUDE.md rule 8).
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
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

/** Codes with a dedicated entry under `errors` in the locale files. */
export const KNOWN_ERROR_CODES = [
  "CSRF_INVALID",
  "UNAUTHORIZED",
  "NETWORK_ERROR",
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "ACCOUNT_LOCKED",
  "ACCOUNT_BLOCKED",
  "EMAIL_NOT_VERIFIED",
  "OTP_INVALID",
  "PASSWORD_TOO_WEAK",
  "VALIDATION_ERROR",
  "NOT_ADMIN",
  "SLUG_TAKEN",
  "CATEGORY_HAS_PRODUCTS",
  "CATEGORY_HAS_CHILDREN",
  "NOT_FOUND",
  "FORBIDDEN",
  "UPLOAD_NOT_ALLOWED",
  "STALE_UPDATE",
  "CITY_CODE_IMMUTABLE",
  "INVALID_TRANSITION",
  "EMAIL_IN_USE",
  "SELF_BLOCK",
  "LAST_ADMIN",
  "VAT_NUMBER_REQUIRED",
  "PRODUCT_NOT_PUBLISHED",
  "DUPLICATE_PRODUCT",
  "SAME_PASSWORD",
  "ALREADY_VERIFIED",
  "CUSTOMER_HAS_OPEN_ORDERS",
  "FORBIDDEN_TARGET",
  "CUSTOMER_DELETED",
  "CONFIRM_EMAIL_MISMATCH",
] as const;

/** Locale key for an error code, with a generic fallback. */
export function errorKey(code: string): string {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code) ? `errors.${code}` : "errors.generic";
}

export function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
}
