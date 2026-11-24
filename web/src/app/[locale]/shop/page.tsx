import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ShopFrame } from "@/components/shop/shop-controls";
import { ActiveChips, Pagination, ProductGrid } from "@/components/shop/shop-results";
import type { Locale } from "@/i18n/routing";
import { getCategories, getProducts } from "@/lib/api/public";
import { formatNumber } from "@/lib/format";
import { alternatesFor } from "@/lib/seo";
import { parseFilters, toApiQuery, type RawParams } from "@/lib/shop";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "shop" });
  return { title: `${t("title")} | Furnixa`, alternates: alternatesFor(locale, "/shop") };
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
