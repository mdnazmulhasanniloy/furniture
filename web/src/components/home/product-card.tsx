"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useState } from "react";

import { ImagePlaceholder } from "@/components/brand";
import { Price } from "@/components/format";
import { FavouriteHeart } from "@/components/product/favourite-heart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { HomeProduct } from "@/lib/api/public";
import { flyToCart } from "@/lib/cart/fly";
import { addToCart } from "@/lib/cart/store";
import { pick } from "@/lib/pick";
import { useMotionPrefs } from "@/lib/use-motion-prefs";

const SIZES = "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 50vw";

/**
 * Product card (PROD-01, design-system section 4): 4:5 image with a second-image crossfade on hover,
 * type/condition badge, heart toggle (shown when `favourite` is passed, FAV-01), 2-line title, price in
 * the price colour, quick add / disabled "Sold out". Hover lift and crossfade are Framer Motion and
 * switch off under prefers-reduced-motion.
 */
export function ProductCard({
  product,
  locale,
  favourite,
}: {
  product: HomeProduct & { isFeatured?: boolean };
  locale: Locale;
  favourite?: { active: boolean; toggle: () => void };
}) {
  const t = useTranslations();
  const { reduced } = useMotionPrefs();
  const [hover, setHover] = useState(false);
  const title = pick(product.title, locale);
  const [first, second] = product.images ?? [];
  const soldOut = product.stock <= 0;
  const resale = product.type === "RESALE";

  return (
    <li>
      <motion.div
        data-testid="product-card"
        whileHover={reduced ? undefined : { y: -4 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        onHoverStart={() => setHover(true)}
        onHoverEnd={() => setHover(false)}
        className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card"
      >
        <Link
          href={`/shop/${encodeURIComponent(product.slug)}`}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="relative aspect-[4/5] overflow-hidden bg-muted" data-testid="card-media">
            {first ? (
              <Image
                src={first.url}
                alt={pick(first.alt, locale) || title}
                fill
                sizes={SIZES}
                className={soldOut ? "object-cover opacity-60" : "object-cover"}
              />
            ) : (
              <ImagePlaceholder name={t("home.brand")} />
            )}
            {first && second ? (
              <motion.div
                data-testid="card-second-image"
                aria-hidden
                className="absolute inset-0"
                initial={false}
                animate={{ opacity: hover ? 1 : 0 }}
                transition={{ duration: reduced ? 0 : 0.35 }}
              >
                <Image src={second.url} alt="" fill sizes={SIZES} className="object-cover" />
              </motion.div>
            ) : null}
            <div className="absolute start-2 top-2 flex flex-col items-start gap-1">
              <Badge variant={resale ? "preowned" : "new"}>
                {resale
                  ? t("badge.preowned", { grade: t(`condition.${product.condition}`) })
                  : t("badge.new")}
              </Badge>
              {product.isFeatured ? <Badge variant="featured">{t("badge.featured")}</Badge> : null}
            </div>
          </div>
          <div className="space-y-1 p-3">
            <h3 className="line-clamp-2 min-h-10 text-sm font-medium leading-5">{title}</h3>
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
        {favourite ? (
          <FavouriteHeart
            active={favourite.active}
            onToggle={favourite.toggle}
            className="absolute end-2 top-2"
          />
        ) : null}
        <div className="mt-auto p-3 pt-0">
          <Button
            type="button"
            size="sm"
            variant={soldOut ? "outline" : "default"}
            className="w-full"
            data-testid="quick-add"
            disabled={soldOut}
            onClick={async (e) => {
              const from = e.currentTarget;
              if (await addToCart(product, 1)) flyToCart(from);
            }}
          >
            {soldOut ? t("badge.soldOut") : t("cart.addToCart")}
          </Button>
        </div>
      </motion.div>
    </li>
  );
}
