// Latin fonts (en): design-system.md section 2 (ADR-015). Loaded only by the en layout branch, which
// scopes the @font-face CSS per locale: /ar never downloads these files.
// preload must stay false: Next's font-preload manifest is per route entry, and
// [locale] is one entry, so preload: true would inject BOTH locales' fonts on every
// page (verified against .next/server/next-font-manifest.json, Next 16.4).
import { IBM_Plex_Sans, Readex_Pro } from "next/font/google";

// Readex Pro: weight (160-700) and the HEXP width axis are the design device (hero = light and wide).
export const heading = Readex_Pro({
  subsets: ["latin"],
  axes: ["HEXP"],
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
