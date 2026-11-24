import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXT_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Map Arabic-Indic and Persian digits (typed on an Arabic keyboard) to ASCII; other characters are kept. */
export function toAsciiDigits(v: string): string {
  return Array.from(v)
    .map((c) => {
      const a = ARABIC_INDIC.indexOf(c);
      if (a >= 0) return String(a);
      const b = EXT_ARABIC_INDIC.indexOf(c);
      return b >= 0 ? String(b) : c;
    })
    .join("");
}
