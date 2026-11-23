import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/seo";

// Private/transactional areas are kept out of search indexes (NFR-03).
const PRIVATE = ["account", "cart", "checkout", "login", "register", "verify", "forgot-password", "reset-password"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", ...routing.locales.flatMap((l) => PRIVATE.map((p) => `/${l}/${p}`))],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
