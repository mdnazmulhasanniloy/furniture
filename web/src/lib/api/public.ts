import type { LocalizedText } from "@/lib/pick";

// Server-side reads of public endpoints for the layout shell (T-032). Runs on the
// Next server, so it calls the backend origin directly (the /api rewrite is for the
// browser). Tags let the backend's revalidate hook refresh them (`settings`, `home`).
// Any failure degrades to an empty shell instead of breaking every page.

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:1000";

export type Category = {
  id: string;
  name: LocalizedText;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  children?: Category[];
};

export type SiteSettings = {
  logo?: { url?: string } | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: LocalizedText | null;
  socials?: {
    facebook?: string | null;
    instagram?: string | null;
    whatsapp?: string | null;
    tiktok?: string | null;
  } | null;
};

async function getJson<T>(path: string, tags: string[]): Promise<T | null> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1${path}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60, tags },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getCategories(): Promise<Category[]> {
  const data = await getJson<Category[]>("/categories", ["categories", "home"]);
  return Array.isArray(data) ? data : [];
}

export async function getSettings(): Promise<SiteSettings | null> {
  return getJson<SiteSettings>("/cms/settings", ["settings"]);
}

// ---- Home (T-033, ADM-06 / ADM-07) ----

export type ImageAsset = {
  key?: string;
  url: string;
  alt?: LocalizedText | null;
  width?: number | null;
  height?: number | null;
};

export type Banner = {
  id: string;
  title: LocalizedText;
  subtitle?: LocalizedText | null;
  ctaLabel?: LocalizedText | null;
  ctaHref?: string | null;
  imageDesktop: ImageAsset;
  imageMobile?: ImageAsset | null;
};

export type HomeProduct = {
  id: string;
  slug: string;
  title: LocalizedText;
  type: "NEW" | "RESALE";
  condition: "NEW" | "LIKE_NEW" | "GOOD" | "FAIR";
  price: number;
  compareAtPrice?: number | null;
  stock: number;
  images: ImageAsset[];
};

export type HomeCategory = {
  id: string;
  slug: string;
  name: LocalizedText;
  image?: ImageAsset | null;
};

export type HomeSectionType =
  | "FEATURED_PRODUCTS"
  | "NEW_ARRIVALS"
  | "RESALE_PICKS"
  | "CATEGORY_GRID"
  | "PROMO_BANNER"
  | "TESTIMONIALS";

export type HomeSection = {
  id: string;
  type: HomeSectionType;
  title: LocalizedText;
  subtitle?: LocalizedText | null;
  config?: {
    testimonials?: { name: string; quote: LocalizedText }[];
  } | null;
  products?: HomeProduct[];
  categories?: HomeCategory[];
  banner?: Banner;
};

export type HomeContent = { banners: Banner[]; sections: HomeSection[] };

/** `GET /cms/home` — tag `home` is revalidated by the backend on banner/section writes. */
export async function getHome(): Promise<HomeContent> {
  const data = await getJson<Partial<HomeContent>>("/cms/home", ["home"]);
  return {
    banners: Array.isArray(data?.banners) ? data.banners : [],
    sections: Array.isArray(data?.sections) ? data.sections : [],
  };
}
