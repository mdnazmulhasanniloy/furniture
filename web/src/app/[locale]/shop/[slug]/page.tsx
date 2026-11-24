import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ProductDetailView } from "@/components/product/product-detail";
import type { Locale } from "@/i18n/routing";
import { getProduct, getSettings } from "@/lib/api/public";
import { pick } from "@/lib/pick";
import { alternatesFor, ogDefaults } from "@/lib/seo";

type Props = Readonly<{ params: Promise<{ locale: string; slug: string }> }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const result = await getProduct(slug);
  // Not there: this render ends in the 404, whose title and description come from the layout's
  // default - Next drops the metadata of a segment that calls notFound() (QA B7).
  if (result.status !== "ok") return {};
  const { product } = result;
  const description = pick(product.description, locale).replace(/\s+/g, " ").trim().slice(0, 160);
  const image = product.images?.[0]?.url;
  const title = pick(product.title, locale);
  // An absent key inherits the layout's description; `description: undefined` clears it (measured).
  return {
    title,
    ...(description ? { description } : {}),
    alternates: alternatesFor(locale, `/shop/${slug}`),
    // The product's main photo when it has one; otherwise the segment's default brand image (QA B7).
    openGraph: {
      ...ogDefaults(locale),
      type: "website",
      title,
      ...(description ? { description } : {}),
      ...(image ? { images: [image] } : {}),
    },
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
      <main className="container-wide py-8">
        <p
          role="alert"
          className="bg-muted p-6 text-center text-sm"
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
