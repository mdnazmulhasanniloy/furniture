import { getTranslations } from "next-intl/server";

import { Price } from "@/components/format";
import { ConnectedProductCard, ProductHeart } from "@/components/favourites/connected-card";
import { Gallery } from "@/components/product/gallery";
import { AddToCartBox } from "@/components/product/add-to-cart-box";
import type { Locale } from "@/i18n/routing";
import type { HomeProduct, ProductDetail, SiteSettings } from "@/lib/api/public";
import { formatNumber } from "@/lib/format";
import { pick } from "@/lib/pick";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-border py-2 text-sm">
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
  const vat = settings?.vat;
  const description = pick(product.description, locale);
  const notes = pick(product.conditionNotes, locale);
  const d = product.dimensions;
  const num = (n: number) => formatNumber(n, locale);
  const hasDims = !!d && d.widthCm != null && d.depthCm != null && d.heightCm != null;
  const category = product.category ? pick(product.category.name, locale) : "";

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="grid gap-8 lg:grid-cols-2">
        <Gallery images={product.images ?? []} title={title} locale={locale} />

        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-sm bg-muted px-2 py-0.5 font-medium">
              {resale
                ? t("badge.preowned", { grade: t(`condition.${product.condition}`) })
                : t("badge.new")}
            </span>
            {soldOut ? (
              <span className="rounded-sm bg-foreground px-2 py-0.5 text-background">
                {t("badge.soldOut")}
              </span>
            ) : null}
          </div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display text-3xl font-semibold">{title}</h1>
            <ProductHeart product={product} />
          </div>

          <p className="flex flex-wrap items-baseline gap-3">
            <span className="text-2xl font-semibold" data-testid="price">
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

          {resale ? (
            <section aria-labelledby="cond-h" className="rounded-lg border border-border p-4">
              <h2 id="cond-h" className="font-medium">
                {t("product.condition.title")}
              </h2>
              <p className="mt-1 text-sm" data-testid="condition-grade">
                {t("product.condition.grade")}: {t(`condition.${product.condition}`)}
              </p>
              {notes ? (
                <p
                  className="mt-2 whitespace-pre-line text-sm text-muted-foreground"
                  data-testid="condition-notes"
                >
                  {notes}
                </p>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="deliv-h" className="rounded-lg bg-muted p-4 text-sm">
            <h2 id="deliv-h" className="font-medium">
              {t("product.delivery.title")}
            </h2>
            <p className="mt-1">{t("product.delivery.body")}</p>
            <p className="text-muted-foreground">{t("product.delivery.cod")}</p>
          </section>
        </div>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {description ? (
          <section aria-labelledby="desc-h">
            <h2 id="desc-h" className="font-display text-xl font-semibold">
              {t("product.description")}
            </h2>
            {/* Plain text per api-spec ProductDescription (no HTML): rendered as text, never as markup. */}
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed" data-testid="description">
              {description}
            </p>
          </section>
        ) : null}
        <section aria-labelledby="spec-h">
          <h2 id="spec-h" className="font-display text-xl font-semibold">
            {t("product.specs.title")}
          </h2>
          <dl className="mt-2" data-testid="specs">
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
        <section aria-labelledby="rel-h" className="mt-12">
          <h2 id="rel-h" className="font-display text-xl font-semibold">
            {t("product.related")}
          </h2>
          <ul
            aria-label={t("product.relatedLabel")}
            className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [&>li]:w-64 [&>li]:shrink-0 [&>li]:snap-start"
            data-testid="related"
          >
            {related.map((p) => (
              <ConnectedProductCard key={p.id} product={p} locale={locale} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
