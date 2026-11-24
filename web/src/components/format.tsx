import type { Locale } from "@/i18n/routing";
import { formatSaudiPhone } from "@/lib/format/phone";
import { formatPrice } from "@/lib/format";

/** Price inside <bdi> so symbol and number do not reorder in Arabic text. */
export function Price({ halalas, locale }: { halalas: number; locale: Locale }) {
  return <bdi className="text-price">{formatPrice(halalas, locale)}</bdi>;
}

export function PhoneText({ value }: { value: string }) {
  return <span dir="ltr">{formatSaudiPhone(value)}</span>;
}
