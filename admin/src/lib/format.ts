// design-system §8 / ADR-008 (copy of the web helpers). Western digits + Gregorian dates
// (B-015 draft assumption) pinned via Unicode extensions. Money is integer halalas and is
// shown exactly as the API returns it: the only operation is the documented halalas / 100.
export type Locale = "ar" | "en";

const NUMBER_TAG: Record<Locale, string> = {
  ar: "ar-SA-u-nu-latn",
  en: "en-SA-u-nu-latn",
};
const DATE_TAG: Record<Locale, string> = {
  ar: "ar-SA-u-ca-gregory-nu-latn",
  en: "en-SA-u-ca-gregory-nu-latn",
};

export const toLocale = (l: string): Locale => (l === "en" ? "en" : "ar");

export function formatPrice(halalas: number, locale: Locale): string {
  return new Intl.NumberFormat(NUMBER_TAG[locale], {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: halalas % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(halalas / 100);
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(NUMBER_TAG[locale]).format(value);
}

/** Date and time of an instant, shown in Asia/Riyadh (the day boundary the API uses). */
export function formatDateTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(DATE_TAG[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Riyadh",
  }).format(new Date(value));
}

/** A Riyadh `YYYY-MM-DD` calendar date from the API (no time zone shift). */
export function formatDay(ymd: string, locale: Locale): string {
  return new Intl.DateTimeFormat(DATE_TAG[locale], {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${ymd}T00:00:00Z`));
}
