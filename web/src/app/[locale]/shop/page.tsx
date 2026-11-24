import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ShopFrame } from "@/components/shop/shop-controls";
import { ActiveChips, Pagination, ProductGrid } from "@/components/shop/shop-results";
import type { Locale } from "@/i18n/routing";
import { getCategories, getProducts, getSettings } from "@/lib/api/public";
import { pick } from "@/lib/pick";
import { formatNumber } from "@/lib/format";
import { alternatesFor } from "@/lib/seo";
import { parseFilters, toApiQuery, type RawParams } from "@/lib/shop";

/**
 * QA B7: the listing names itself after the category it is filtering by, and carries its own
 * description built from that category; without a filter it is the shop with the catalogue sentence.
 */
export async function generateMetadata({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawParams>;
}>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "shop" });
  const filters = parseFilters(await searchParams);
  const settings = await getSettings();
  const brand = pick(settings?.storeName, locale) || "Furnixa";
  const category = filters.category
    ? (await getCategories())?.find((c) => c.slug === filters.category)
    : undefined;
  const name = category ? pick(category.name, locale) : "";
  return {
    title: name || t("title"),
    description: name
      ? t("metaDescription", { category: name, brand })
      : t("metaDescriptionAll", { brand }),
    alternates: alternatesFor(locale, "/shop"),
  };
}

export default async function ShopPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawParams>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("shop");
  const filters = parseFilters(await searchParams);
  const [categories, result] = await Promise.all([
    getCategories(),
    getProducts(toApiQuery(filters)),
  ]);

  return (
    <main className="container-wide band">
      <h1 className="text-4xl md:text-5xl">{t("title")}</h1>
      <ShopFrame filters={filters} categories={categories} locale={locale}>
        {result ? (
          <>
            <p className="text-sm text-muted-foreground" role="status" data-testid="shop-count">
              {t("count", { count: result.meta.total, formatted: formatNumber(result.meta.total, locale as Locale) })}
            </p>
            <ActiveChips filters={filters} categories={categories} locale={locale as Locale} />
            <ProductGrid items={result.items} locale={locale as Locale} filters={filters} />
            <Pagination filters={filters} meta={result.meta} />
          </>
        ) : (
          <p
            role="alert"
            className="rounded-lg bg-blush p-6 text-center text-base text-blush-foreground"
            data-testid="shop-error"
          >
            {t("loadError")}
          </p>
        )}
      </ShopFrame>
    </main>
  );
}
