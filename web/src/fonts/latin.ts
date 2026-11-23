// Latin fonts (en): design-system.md §2. Loaded only by the en layout branch, which
// scopes the @font-face CSS per locale: /ar never downloads Latin font files.
// preload must stay false: Next's font-preload manifest is per route entry, and
// [locale] is one entry, so preload: true would inject BOTH locales' fonts on every
// page (verified against .next/server/next-font-manifest.json, Next 16.4).
import { Fraunces, Manrope } from "next/font/google";

export const heading = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-heading",
  display: "swap",
  preload: false,
});

export const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
  preload: false,
});
