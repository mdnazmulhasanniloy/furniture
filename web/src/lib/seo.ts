import { getTranslations } from "next-intl/server";

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

/**
 * The title and description a 404 must show (QA B7, measured): Next drops the metadata of a segment
 * that calls `notFound()`, and `not-found.tsx` cannot export metadata, so the only place a 404 title
 * can come from is the layout's `title.default`. That default is therefore this - and every real page
 * sets a title of its own, the home page included, so the default is only ever seen on a 404.
 * The copy is the same `pages.notFound.*` the 404 page itself shows.
 */
export async function notFoundMeta(locale: string): Promise<{ title: string; description: string }> {
  const t = await getTranslations({ locale, namespace: "pages.notFound" });
  return { title: t("title"), description: t("body") };
}

/**
 * The segment's generated brand image (`app/[locale]/opengraph-image.tsx`). Next attaches it on its
 * own to every page that does not define `openGraph` itself; a page that does replaces the whole
 * object (shallow merge), so it has to name the image again - measured in QA B7.
 */
export const defaultOgImage = (locale: string): string => `/${locale}/opengraph-image`;

/**
 * The Open Graph fields a page must repeat when it sets `openGraph` itself: Next merges metadata
 * shallowly, so a page-level `openGraph` replaces the layout's entirely, site name and image included
 * (measured in QA B7). Spread this first, then the page's own title, description or image.
 */
export const ogDefaults = (locale: string) => ({
  siteName: "Furnixa",
  locale,
  images: [defaultOgImage(locale)],
});
