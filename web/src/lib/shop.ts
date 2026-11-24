// Shop listing filters <-> URL <-> API query (PROD-01). The URL is the single source of
// truth so every filter state is shareable. Unknown or malformed values are dropped.

export const CONDITIONS = ["NEW", "LIKE_NEW", "GOOD", "FAIR"] as const;
export type ConditionGrade = (typeof CONDITIONS)[number];
export const SORTS = ["newest", "price_asc", "price_desc", "featured"] as const;
export type Sort = (typeof SORTS)[number];

export type ShopFilters = {
  q?: string;
  category?: string;
  type?: "NEW" | "RESALE";
  condition: ConditionGrade[];
  /** halalas, as the API takes them */
  minPrice?: number;
  maxPrice?: number;
  material?: string;
  inStock: boolean;
  sort: Sort;
  page: number;
};

export type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The API caps `q` at 100 characters and 6 words and answers 422 beyond that (owner 2026-11-24). The
 * storefront never shows that error: it searches with the first 6 words instead, silently. Every `q` goes
 * through `parseFilters`, so a typed search, a shared URL and the filter chip all use the same trimmed value.
 */
export const MAX_QUERY_LENGTH = 100;
export const MAX_QUERY_WORDS = 6;

export function trimQuery(raw: string): string {
  return raw
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_QUERY_WORDS)
    .join(" ");
}

function intParam(v: string | undefined): number | undefined {
  if (v === undefined || !/^\d{1,9}$/.test(v)) return undefined;
  return Number(v);
}

export function parseFilters(params: RawParams): ShopFilters {
  const q = trimQuery(first(params.q) ?? "");
  const category = first(params.category)?.trim();
  const type = first(params.type)?.toUpperCase();
  const condition = (first(params.condition) ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c): c is ConditionGrade => (CONDITIONS as readonly string[]).includes(c));
  const sort = first(params.sort);
  const page = intParam(first(params.page));
  return {
    q: q || undefined,
    category: category || undefined,
    type: type === "NEW" || type === "RESALE" ? type : undefined,
    condition: [...new Set(condition)],
    minPrice: intParam(first(params.minPrice)),
    maxPrice: intParam(first(params.maxPrice)),
    material: first(params.material)?.trim().slice(0, 60) || undefined,
    inStock: first(params.inStock) === "true",
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as Sort) : "newest",
    page: page && page > 0 ? page : 1,
  };
}

/** Canonical query string for the page URL (defaults omitted). */
export function toUrlQuery(f: ShopFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.category) p.set("category", f.category);
  if (f.type) p.set("type", f.type.toLowerCase());
  if (f.condition.length) p.set("condition", f.condition.join(","));
  if (f.minPrice !== undefined) p.set("minPrice", String(f.minPrice));
  if (f.maxPrice !== undefined) p.set("maxPrice", String(f.maxPrice));
  if (f.material) p.set("material", f.material);
  if (f.inStock) p.set("inStock", "true");
  if (f.sort !== "newest") p.set("sort", f.sort);
  if (f.page > 1) p.set("page", String(f.page));
  return p.toString();
}

export function shopHref(f: ShopFilters): string {
  const qs = toUrlQuery(f);
  return qs ? `/shop?${qs}` : "/shop";
}

/** Query for `GET /products` (api-spec: condition is comma-separated, type upper-case). */
export function toApiQuery(f: ShopFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.category) p.set("category", f.category);
  if (f.type) p.set("type", f.type);
  if (f.condition.length) p.set("condition", f.condition.join(","));
  if (f.minPrice !== undefined) p.set("minPrice", String(f.minPrice));
  if (f.maxPrice !== undefined) p.set("maxPrice", String(f.maxPrice));
  if (f.material) p.set("material", f.material);
  if (f.inStock) p.set("inStock", "true");
  p.set("sort", f.sort);
  p.set("page", String(f.page));
  p.set("limit", String(PAGE_SIZE));
  return p.toString();
}

export const PAGE_SIZE = 24;

/** Filter change always returns to page 1. */
export function withChange(f: ShopFilters, change: Partial<ShopFilters>): ShopFilters {
  return { ...f, ...change, page: change.page ?? 1 };
}

export function hasActiveFilters(f: ShopFilters): boolean {
  return !!(
    f.q ||
    f.category ||
    f.type ||
    f.condition.length ||
    f.minPrice !== undefined ||
    f.maxPrice !== undefined ||
    f.material ||
    f.inStock
  );
}

/** Page numbers to show: first, last and a window around the current page; null = gap. */
export function pageWindow(current: number, total: number): (number | null)[] {
  const keep = new Set([1, total, current - 1, current, current + 1]);
  const pages = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  pages.forEach((n, i) => {
    if (i > 0 && n - pages[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}
