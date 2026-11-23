import { routing } from "@/i18n/routing";

/** Public origin of the storefront (metadata, sitemap, hreflang). */
export function siteUrl(): string {
  return (process.env.STOREFRONT_URL ?? "http://localhost:3100").replace(/\/+$/, "");
}

/** Path for a locale, e.g. `localePath("en", "/shop")` -> `/en/shop`; home is `/en`. */
export function localePath(locale: string, path: string): string {
  return path === "/" || path === "" ? `/${locale}` : `/${locale}${path}`;
}

/**
 * Canonical + hreflang alternates for a locale-independent path (NFR-03). `x-default`
 * points at the default locale. URLs resolve against `metadataBase` (set in the layout).
 */
export function alternatesFor(locale: string, path: string) {
  return {
    canonical: localePath(locale, path),
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, localePath(l, path)])),
      "x-default": localePath(routing.defaultLocale, path),
    },
  };
}
