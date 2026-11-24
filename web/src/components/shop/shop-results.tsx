import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Price } from "@/components/format";
import { ConnectedProductCard } from "@/components/favourites/connected-card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { Category, HomeProduct, ProductPageMeta } from "@/lib/api/public";
import { pick } from "@/lib/pick";
import {
  type ShopFilters,
  hasActiveFilters,
  pageWindow,
  shopHref,
  withChange,
} from "@/lib/shop";

function findCategoryName(categories: Category[], slug: string, locale: string): string {
  for (const c of categories) {
    if (c.slug === slug) return pick(c.name, locale);
    const child = c.children?.find((x) => x.slug === slug);
    if (child) return pick(child.name, locale);
  }
  return slug;
}

export function ActiveChips({
  filters,
  categories,
  locale,
}: {
  filters: ShopFilters;
  categories: Category[];
  locale: Locale;
}) {
  const t = useTranslations("shop");
  const tc = useTranslations("condition");
  const chips: { key: string; label: React.ReactNode; href: string }[] = [];
  const drop = (change: Partial<ShopFilters>) => shopHref(withChange(filters, change));

  if (filters.q)
    chips.push({ key: "q", label: t("chip.q", { q: filters.q }), href: drop({ q: undefined }) });
  if (filters.category)
    chips.push({
      key: "category",
      label: findCategoryName(categories, filters.category, locale),
      href: drop({ category: undefined }),
    });
  if (filters.type)
    chips.push({
      key: "type",
      label: filters.type === "NEW" ? t("type.new") : t("type.resale"),
      href: drop({ type: undefined }),
    });
  for (const c of filters.condition)
    chips.push({
      key: `c-${c}`,
      label: tc(c),
      href: drop({ condition: filters.condition.filter((x) => x !== c) }),
    });
  if (filters.minPrice !== undefined)
    chips.push({
      key: "min",
      label: (
        <>
          {t("chip.min")} <Price halalas={filters.minPrice} locale={locale} />
        </>
      ),
      href: drop({ minPrice: undefined }),
    });
  if (filters.maxPrice !== undefined)
    chips.push({
      key: "max",
      label: (
        <>
          {t("chip.max")} <Price halalas={filters.maxPrice} locale={locale} />
        </>
      ),
      href: drop({ maxPrice: undefined }),
    });
  if (filters.material)
    chips.push({ key: "material", label: filters.material, href: drop({ material: undefined }) });
  if (filters.inStock)
    chips.push({ key: "stock", label: t("inStock"), href: drop({ inStock: false }) });

  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t("activeFilters")}>
      {chips.map((c) => (
        <li key={c.key}>
          <Link
            href={c.href}
            data-chip={c.key}
            className="inline-flex items-center gap-1.5 rounded-sm bg-muted px-3 py-1.5 text-[0.8125rem] text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {c.label}
            <X className="size-3" aria-hidden />
            <span className="sr-only">{t("removeFilter")}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ProductGrid({
  items,
  locale,
  filters,
}: {
  items: HomeProduct[];
  locale: Locale;
  filters: ShopFilters;
}) {
  const t = useTranslations("shop");
  if (items.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-4 rounded-lg bg-blush px-4 py-16 text-center text-blush-foreground"
        data-testid="shop-empty"
      >
        <p className="font-display text-2xl font-bold">{t("empty.title")}</p>
        <p className="max-w-sm text-base text-muted-foreground">{t("empty.body")}</p>
        {hasActiveFilters(filters) && (
          <Link
            href="/shop"
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t("clearFilters")}
          </Link>
        )}
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-3 lg:gap-x-6 xl:grid-cols-4" data-testid="shop-grid">
      {items.map((p) => (
        <ConnectedProductCard key={p.id} product={p} locale={locale} />
      ))}
    </ul>
  );
}

export function Pagination({ filters, meta }: { filters: ShopFilters; meta: ProductPageMeta }) {
  const t = useTranslations("shop");
  if (meta.totalPages <= 1) return null;
  const current = filters.page;
  const href = (page: number) => shopHref({ ...filters, page });
  const cls =
    "inline-flex size-10 items-center justify-center rounded-md text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <nav
      aria-label={t("pagination")}
      className="mt-8 flex flex-wrap items-center justify-center gap-2"
    >
      {current > 1 && (
        <Link href={href(current - 1)} className={cls} aria-label={t("prevPage")} rel="prev">
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
        </Link>
      )}
      {pageWindow(current, meta.totalPages).map((n, i) =>
        n === null ? (
          <span key={`gap-${i}`} aria-hidden>
            …
          </span>
        ) : n === current ? (
          <span
            key={n}
            aria-current="page"
            className={`${cls} bg-primary text-primary-foreground hover:bg-primary`}
          >
            {n}
          </span>
        ) : (
          <Link key={n} href={href(n)} className={cls} aria-label={t("goToPage", { n })}>
            {n}
          </Link>
        ),
      )}
      {current < meta.totalPages && (
        <Link href={href(current + 1)} className={cls} aria-label={t("nextPage")} rel="next">
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </Link>
      )}
    </nav>
  );
}
