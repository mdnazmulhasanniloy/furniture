import { Rail } from "@/components/rail";
import { getTranslations } from "next-intl/server";

import { Price } from "@/components/format";
import { ConnectedProductCard, ProductHeart } from "@/components/favourites/connected-card";
import { AddToCartBox } from "@/components/product/add-to-cart-box";
import { ConditionReport } from "@/components/product/condition-report";
import { Gallery } from "@/components/product/gallery";
import { StickyBuyBar } from "@/components/product/sticky-buy-bar";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { HomeProduct, ProductDetail, SiteSettings } from "@/lib/api/public";
import { formatNumber, formatPercent } from "@/lib/format";
import { pick } from "@/lib/pick";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-border py-3 text-sm">
      <dt className="w-2/5 text-muted-foreground">{label}</dt>
      <dd className="flex-1">{children}</dd>
    </div>
  );
}

export async function ProductDetailView({
  product,
  related,
  settings,
  locale,
}: {
  product: ProductDetail;
  related: HomeProduct[];
  settings: SiteSettings | null;
  locale: Locale;
}) {
  const t = await getTranslations({ locale });
  const title = pick(product.title, locale);
  const soldOut = product.stock <= 0;
  const resale = product.type === "RESALE";
  const hasCompare = !!product.compareAtPrice && product.compareAtPrice > product.price;
  // the same percentage the product cards show
  const off = hasCompare ? Math.round((((product.compareAtPrice as number) - product.price) / (product.compareAtPrice as number)) * 100) : 0;
  const vat = settings?.vat;
  const description = pick(product.description, locale);
  const d = product.dimensions;
  const num = (n: number) => formatNumber(n, locale);
  const hasDims = !!d && d.widthCm != null && d.depthCm != null && d.heightCm != null;
  const category = product.category ? pick(product.category.name, locale) : "";

  return (
    <main className="container-wide pb-24 pt-6 md:pt-8 lg:pb-0">
      <nav aria-label={t("product.breadcrumb.label")} data-testid="breadcrumb">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <li>
            <Link href="/" className="underline-offset-4 hover:underline">
              {t("product.breadcrumb.home")}
            </Link>
          </li>
          {product.category ? (
            <li className="flex items-center gap-2">
              <span aria-hidden>/</span>
              <Link
                href={`/shop?category=${encodeURIComponent(product.category.slug)}`}
                className="underline-offset-4 hover:underline"
              >
                {category}
              </Link>
            </li>
          ) : null}
          <li className="flex items-center gap-2" aria-current="page">
            <span aria-hidden>/</span>
            <span className="text-foreground">{title}</span>
          </li>
        </ol>
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-14">
        <Gallery images={product.images ?? []} title={title} locale={locale} />

        {/* Sticky buy box on desktop; on mobile the bottom bar (StickyBuyBar) follows the inline button. */}
        <div data-testid="buy-box" className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={resale ? "preowned" : "new"}>
              {resale
                ? t("badge.preowned", { grade: t(`condition.${product.condition}`) })
                : t("badge.new")}
            </Badge>
            {soldOut ? <Badge variant="soldOut">{t("badge.soldOut")}</Badge> : null}
            {!soldOut && off > 0 ? (
              <Badge variant="featured" data-testid="sale-badge">
                <bdi>{`−${formatPercent(off / 100, locale)}`}</bdi>
              </Badge>
            ) : null}
          </div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-3xl md:text-4xl">{title}</h1>
            <ProductHeart product={product} />
          </div>

          <p className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-semibold" data-testid="price">
              <Price halalas={product.price} locale={locale} />
            </span>
            {hasCompare ? (
              <s className="text-base text-muted-foreground" data-testid="compare-price">
                <Price halalas={product.compareAtPrice as number} locale={locale} />
              </s>
            ) : null}
            {vat && vat.vatRate > 0 ? (
              <span className="text-xs text-muted-foreground" data-testid="vat-note">
                {vat.pricesIncludeVat ? t("product.vatIncl") : t("product.vatExcl")}
              </span>
            ) : null}
          </p>

          <p
            className={`text-sm font-medium ${soldOut ? "text-destructive" : resale ? "text-warning-foreground" : "text-success-foreground"}`}
            data-testid="stock-text"
          >
            {soldOut
              ? t("badge.soldOut")
              : resale
                ? t("product.stock.only", { count: product.stock, formatted: num(product.stock) })
                : t("product.stock.in")}
          </p>

          <AddToCartBox product={product} locale={locale} />

          <section aria-labelledby="deliv-h" className="rounded-lg bg-blush p-4 text-base text-blush-foreground">
            <h2 id="deliv-h" className="font-sans text-base font-semibold">
              {t("product.delivery.title")}
            </h2>
            <p className="mt-1">{t("product.delivery.body")}</p>
            <p className="text-muted-foreground">{t("product.delivery.cod")}</p>
          </section>
        </div>
      </div>

      {resale ? (
        <div className="mt-12 md:mt-16">
          {await ConditionReport({ product, locale })}
        </div>
      ) : null}

      <div className="mt-12 grid gap-10 md:mt-16 lg:grid-cols-2 lg:gap-16">
        {description ? (
          <section aria-labelledby="desc-h">
            <h2 id="desc-h" className="text-2xl font-semibold">
              {t("product.description")}
            </h2>
            {/* Plain text per api-spec ProductDescription (no HTML): rendered as text, never as markup. */}
            <p className="measure mt-3 whitespace-pre-line leading-relaxed" data-testid="description">
              {description}
            </p>
          </section>
        ) : null}
        <section aria-labelledby="spec-h">
          <h2 id="spec-h" className="text-2xl font-semibold">
            {t("product.specs.title")}
          </h2>
          <dl className="mt-3" data-testid="specs">
            {product.sku ? (
              <Row label={t("product.specs.sku")}>
                <bdi>{product.sku}</bdi>
              </Row>
            ) : null}
            {category ? <Row label={t("product.specs.category")}>{category}</Row> : null}
            {product.material ? <Row label={t("product.specs.material")}>{product.material}</Row> : null}
            {product.color ? <Row label={t("product.specs.color")}>{product.color}</Row> : null}
            {hasDims ? (
              <Row label={t("product.specs.dimensions")}>
                {t("product.specs.dimensionsValue", {
                  w: num(d.widthCm as number),
                  d: num(d.depthCm as number),
                  h: num(d.heightCm as number),
                })}
              </Row>
            ) : null}
            {d?.weightKg != null ? (
              <Row label={t("product.specs.weight")}>
                {t("product.specs.weightValue", { value: num(d.weightKg) })}
              </Row>
            ) : null}
          </dl>
        </section>
      </div>

      {related.length > 0 ? (
        <section aria-labelledby="rel-h" className="mt-16">
          <h2 id="rel-h" className="text-3xl">
            {t("product.related")}
          </h2>
          <Rail label={t("product.relatedLabel")} testId="related" className="mt-6 pb-2 [&>li]:w-60 [&>li]:shrink-0">
            {related.map((p) => (
              <ConnectedProductCard key={p.id} product={p} locale={locale} />
            ))}
          </Rail>
        </section>
      ) : null}

      <StickyBuyBar product={product} locale={locale} />
    </main>
  );
}
