import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { getProducts } from "@/lib/api/public";
import { localePath, siteUrl } from "@/lib/seo";

// Home, shop and published products, one entry per path with hreflang alternates. CMS pages
// are not listed: the API has no list-pages endpoint (blocker B-029).
function entry(path: string): MetadataRoute.Sitemap[number] {
  const base = siteUrl();
  return {
    url: `${base}${localePath(routing.defaultLocale, path)}`,
    alternates: {
      languages: Object.fromEntries(routing.locales.map((l) => [l, `${base}${localePath(l, path)}`])),
    },
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getProducts("limit=100");
  const paths = ["/", "/shop", ...(products?.items ?? []).map((p) => `/shop/${encodeURIComponent(p.slug)}`)];
  return paths.map(entry);
}
