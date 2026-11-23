import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

// ADR-002 amendment: the admin defaults to `ar` and remembers the saved choice.
export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";
export const LOCALE_KEY = "fx_admin_locale";

export const dirOf = (l: Locale): "rtl" | "ltr" => (l === "ar" ? "rtl" : "ltr");

function isLocale(v: unknown): v is Locale {
  return v === "ar" || v === "en";
}

export function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    if (isLocale(v)) return v;
  } catch {
    /* storage unavailable: use the default */
  }
  return DEFAULT_LOCALE;
}

/** Keep <html lang dir> in step with the active language (RTL for Arabic). */
export function applyDocumentLocale(l: Locale) {
  document.documentElement.lang = l;
  document.documentElement.dir = dirOf(l);
}

export async function setLocale(l: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, l);
  } catch {
    /* ignore */
  }
  await i18n.changeLanguage(l);
  applyDocumentLocale(l);
}

export function initI18n(initial: Locale = readStoredLocale()) {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: { en: { translation: en }, ar: { translation: ar } },
      lng: initial,
      fallbackLng: "en",
      // Locale files use {name} placeholders (matches the web messages).
      interpolation: { prefix: "{", suffix: "}", escapeValue: false },
      initAsync: false,
    });
  } else {
    void i18n.changeLanguage(initial);
  }
  applyDocumentLocale(initial);
  return i18n;
}

export default i18n;
