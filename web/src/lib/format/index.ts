import type { Locale } from "@/i18n/routing";

// design-system §8 / ADR-008. Locale tags are pinned to Western digits and
// Gregorian dates (B-015 draft assumption) via Unicode extensions.
const NUMBER_TAG: Record<Locale, string> = {
  ar: "ar-SA-u-nu-latn",
  en: "en-SA-u-nu-latn",
};
const DATE_TAG: Record<Locale, string> = {
  ar: "ar-SA-u-ca-gregory-nu-latn",
  en: "en-SA-u-ca-gregory-nu-latn",
};

/** Money is integer halalas (1 SAR = 100 halalas). Whole riyals show without decimals. */
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

export function formatPercent(rate: number, locale: Locale): string {
  return new Intl.NumberFormat(NUMBER_TAG[locale], {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(rate);
}

export function formatDate(
  value: Date | string | number,
  locale: Locale,
  withTime = false,
): string {
  return new Intl.DateTimeFormat(DATE_TAG[locale], {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value));
}
