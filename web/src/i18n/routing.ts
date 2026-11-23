import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "ar"],
  // ADR-002 amendment (SRC-003.4): default locale is ar; `/` redirects to /ar
  // unless the visitor previously chose en (next-intl NEXT_LOCALE cookie).
  defaultLocale: "ar",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
