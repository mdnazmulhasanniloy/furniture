import type { TFunction } from "i18next";
import { ApiError, errorKey } from "./errors";

/** Retry-After as a localized phrase ("Try again in 12 minutes"); plural category per locale. */
function retryPhrase(t: TFunction, locale: string, seconds: number): string {
  const inSeconds = seconds < 60;
  const n = inSeconds ? Math.max(1, seconds) : Math.ceil(seconds / 60);
  const cat = new Intl.PluralRules(locale).select(n);
  const form = ["one", "two", "few"].includes(cat) ? cat : "other";
  const key = `errors.${inSeconds ? "retrySeconds" : "retryMinutes"}.${form}`;
  return t(key, { n:new Intl.NumberFormat(locale).format(n) });
}

/** Localized text for an error. The API message is never shown (CLAUDE.md rule 8). */
export function errorMessage(t: TFunction, locale: string, e: unknown): string {
  const code = e instanceof ApiError ? e.code : "NETWORK_ERROR";
  let text = t(errorKey(code));
  if ((code === "RATE_LIMITED" || code === "ACCOUNT_LOCKED") && e instanceof ApiError && e.retryAfterSeconds !== undefined) {
    text = `${text} ${retryPhrase(t, locale, e.retryAfterSeconds)}`;
  }
  return text;
}
