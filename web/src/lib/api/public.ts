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
  freeDeliveryThreshold?: number | null;
  deliveryCities?:
    | {
        code: string;
        name?: LocalizedText | null;
        isActive?: boolean;
        sortOrder?: number;
        deliveryFee?: number | null;
      }[]
    | null;
  seo?: { title?: LocalizedText | null; description?: LocalizedText | null } | null;
  vat?: { vatRate: number; applyToDelivery?: boolean; pricesIncludeVat: boolean } | null;
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

// ---- Shop listing (T-034, PROD-01 / CAT-01) ----

export type ProductPageMeta = { page: number; limit: number; total: number; totalPages: number };

/** `GET /products`; null when the API is unreachable (the page shows an error, not "empty"). */
export async function getProducts(
  query: string,
): Promise<{ items: HomeProduct[]; meta: ProductPageMeta } | null> {
  const data = await getJson<{ items?: HomeProduct[]; meta?: Partial<ProductPageMeta> }>(
    `/products?${query}`,
    ["products"],
  );
  if (!data || !Array.isArray(data.items)) return null;
  const total = data.meta?.total ?? data.items.length;
  return {
    items: data.items,
    meta: {
      page: data.meta?.page ?? 1,
      limit: data.meta?.limit ?? data.items.length,
      total,
      totalPages: data.meta?.totalPages ?? 1,
    },
  };
}

// ---- Product detail (T-035, PROD-02) ----

export type ProductDetail = HomeProduct & {
  description: LocalizedText;
  conditionNotes?: LocalizedText | null;
  sku?: string | null;
  category?: Category | null;
  dimensions?: {
    widthCm?: number | null;
    depthCm?: number | null;
    heightCm?: number | null;
    weightKg?: number | null;
  } | null;
  material?: string | null;
  color?: string | null;
};

export type ProductDetailResult =
  | { status: "ok"; product: ProductDetail; related: HomeProduct[] }
  | { status: "not-found" }
  | { status: "error" };

/**
 * `GET /products/{slug}`. Tags `product:{slug}`, `products` and `settings` (VAT and delivery
 * display change with admin settings; backend T-011). 404 is distinct from an outage.
 */
export async function getProduct(slug: string): Promise<ProductDetailResult> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/products/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60, tags: [`product:${slug}`, "products", "settings"] },
    });
    if (res.status === 404) return { status: "not-found" };
    if (!res.ok) return { status: "error" };
    const data = (await res.json()) as { product?: ProductDetail; related?: HomeProduct[] };
    if (!data.product) return { status: "error" };
    return {
      status: "ok",
      product: data.product,
      related: Array.isArray(data.related) ? data.related : [],
    };
  } catch {
    return { status: "error" };
  }
}

// ---- Static pages (T-041, ADM-08) ----

export type StaticPage = {
  id?: string;
  slug: string;
  title: LocalizedText;
  /** HTML, sanitised by the backend on every write (ADR-013); rendered without further processing. */
  content: LocalizedText;
  metaTitle?: LocalizedText | null;
  metaDescription?: LocalizedText | null;
  updatedAt?: string;
};

export type StaticPageResult =
  | { status: "ok"; page: StaticPage }
  | { status: "not-found" }
  | { status: "error" };

/** `GET /cms/pages/{slug}` (published only). Tag `page:{slug}` is revalidated on admin page writes. */
export async function getPage(slug: string): Promise<StaticPageResult> {
  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/cms/pages/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60, tags: [`page:${slug}`] },
    });
    if (res.status === 404) return { status: "not-found" };
    if (!res.ok) return { status: "error" };
    const page = (await res.json()) as StaticPage;
    if (!page || typeof page !== "object" || !page.title) return { status: "error" };
    return { status: "ok", page };
  } catch {
    return { status: "error" };
  }
}
