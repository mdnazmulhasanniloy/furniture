import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ProductDetailView } from "@/components/product/product-detail";
import type { Locale } from "@/i18n/routing";
import { getProduct, getSettings } from "@/lib/api/public";
import { pick } from "@/lib/pick";
import { alternatesFor } from "@/lib/seo";

type Props = Readonly<{ params: Promise<{ locale: string; slug: string }> }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const result = await getProduct(slug);
  if (result.status !== "ok") return { title: "Furnixa" };
  const { product } = result;
  const description = pick(product.description, locale).replace(/\s+/g, " ").trim().slice(0, 160);
  const image = product.images?.[0]?.url;
  const title = pick(product.title, locale);
  return {
    title: `${title} | Furnixa`,
    description: description || undefined,
    alternates: alternatesFor(locale, `/shop/${slug}`),
    openGraph: { title, description: description || undefined, images: image ? [image] : undefined },
  };
}

export default async function ProductPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [result, settings] = await Promise.all([getProduct(slug), getSettings()]);
  if (result.status === "not-found") notFound();
  if (result.status === "error") {
    const t = await getTranslations("product");
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p
          role="alert"
          className="rounded-lg border border-border p-6 text-center text-sm"
          data-testid="product-error"
        >
          {t("loadError")}
        </p>
      </main>
    );
  }
  return (
    <ProductDetailView
      product={result.product}
      related={result.related}
      settings={settings}
      locale={locale as Locale}
    />
  );
}
