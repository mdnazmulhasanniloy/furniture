// Arabic fonts (ar): design-system.md v3 (ADR-018). Loaded only by the ar layout branch, which
// scopes the @font-face CSS per locale: /en never downloads Arabic font files.
// preload must stay false: see src/fonts/latin.ts for the Next 16 limitation.
import { El_Messiri, IBM_Plex_Sans_Arabic } from "next/font/google";

// The latin subset is included for Western digits and "SAR", which the pinned number format puts
// inside Arabic text; the browser downloads it only when those glyphs are used.
export const heading = El_Messiri({
  weight: ["600", "700"],
  subsets: ["arabic", "latin"],
  variable: "--font-heading",
  display: "swap",
  preload: false,
});

export const body = IBM_Plex_Sans_Arabic({
  weight: ["400", "500", "600"],
  subsets: ["arabic"],
  variable: "--font-body",
  display: "swap",
  preload: false,
});
