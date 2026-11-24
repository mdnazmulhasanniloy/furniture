import type { HomeSection } from "@/lib/api/public";

/**
 * Admin-entered CTA links: only https URLs or same-site paths ("/shop"). Anything else
 * (javascript:, data:, protocol-relative "//host") is dropped.
 */
export function safeHref(
  href: string | null | undefined,
): { href: string; external: boolean } | null {
  if (!href) return null;
  const value = href.trim();
  // Browsers drop tab/newline inside URLs, so "/<TAB>/host" would become "//host": reject backslashes and control chars.
  if (value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(value)) {
    return { href: value, external: false };
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? { href: url.toString(), external: true } : null;
  } catch {
    return null;
  }
}

/** A section with nothing to show is hidden (screen-specs W-01). */
export function sectionHasContent(section: HomeSection): boolean {
  switch (section.type) {
    case "FEATURED_PRODUCTS":
    case "NEW_ARRIVALS":
    case "RESALE_PICKS":
      return (section.products?.length ?? 0) > 0;
    case "CATEGORY_GRID":
      return (section.categories?.length ?? 0) > 0;
    case "PROMO_BANNER":
      return !!section.banner;
    case "TESTIMONIALS":
      return (section.config?.testimonials?.length ?? 0) > 0;
    default:
      return false;
  }
}
