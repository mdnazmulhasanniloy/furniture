// Arabic fonts (ar): design-system.md §2. Loaded only by the ar layout branch, which
// scopes the @font-face CSS per locale: /en never downloads Arabic font files.
// preload must stay false — see src/fonts/latin.ts for the Next 16 limitation.
import { IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic } from "next/font/google";

export const heading = Noto_Kufi_Arabic({
  subsets: ["arabic"],
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
