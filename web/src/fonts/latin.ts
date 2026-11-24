// Latin fonts (en): design-system.md v3 (ADR-018). Loaded only by the en layout branch, which
// scopes the @font-face CSS per locale: /ar never downloads these files.
// preload must stay false: Next's font-preload manifest is per route entry, and
// [locale] is one entry, so preload: true would inject BOTH locales' fonts on every
// page (verified against .next/server/next-font-manifest.json, Next 16.4).
import { Bodoni_Moda, IBM_Plex_Sans } from "next/font/google";

// Bodoni Moda: high-contrast serif, weights 600 and 700 only (never thin), used from 28 px up (CR-011 Q-10).
export const heading = Bodoni_Moda({
  weight: ["600", "700"],
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
  preload: false,
});

export const body = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
  preload: false,
});
