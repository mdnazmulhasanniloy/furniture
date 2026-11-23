import { useTranslations } from "next-intl";
import Image from "next/image";

import { Price } from "@/components/format";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { HomeProduct } from "@/lib/api/public";
import { pick } from "@/lib/pick";

export function ProductCard({
  product,
  locale,
}: {
  product: HomeProduct;
  locale: Locale;
}) {
  const t = useTranslations();
  const title = pick(product.title, locale);
  const image = product.images?.[0];
  const soldOut = product.stock <= 0;
  const badge =
    product.type === "RESALE"
      ? t("badge.preowned", { grade: t(`condition.${product.condition}`) })
      : t("badge.new");

  return (
    <li>
      <Link
        href={`/shop/${encodeURIComponent(product.slug)}`}
        className="group block overflow-hidden rounded-lg border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative aspect-[4/3] bg-muted">
          {image ? (
            <Image
              src={image.url}
              alt={pick(image.alt, locale) || title}
              fill
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
          ) : null}
          <span className="absolute start-2 top-2 rounded-sm bg-card px-2 py-0.5 text-xs font-medium">
            {badge}
          </span>
          {soldOut ? (
            <span className="absolute end-2 top-2 rounded-sm bg-foreground px-2 py-0.5 text-xs text-background">
              {t("badge.soldOut")}
            </span>
          ) : null}
        </div>
        <div className="space-y-1 p-3">
          <h3 className="line-clamp-2 text-sm font-medium">{title}</h3>
          <p className="flex items-baseline gap-2 text-sm">
            <span className="font-semibold">
              <Price halalas={product.price} locale={locale} />
            </span>
            {product.compareAtPrice && product.compareAtPrice > product.price ? (
              <s className="text-xs text-muted-foreground">
                <Price halalas={product.compareAtPrice} locale={locale} />
              </s>
            ) : null}
          </p>
        </div>
      </Link>
    </li>
  );
}
