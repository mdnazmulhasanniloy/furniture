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
import { cn } from "@/lib/utils";

const SIZES = "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 50vw";

/**
 * Product tile (PROD-01, design-system section 5): no border, no shadow, square image on a sand backdrop with
 * the photo multiplied onto it, heart in the top-end corner, 2-line title, price with the condition chip
 * beside it (never on the photo). Quick add is a full-width outlined button: always visible on touch and
 * small screens, revealed on hover or focus on a hovering desktop. The second image crossfades on hover
 * (Framer Motion, off under reduced motion).
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
      <div data-testid="product-card" className="group relative flex h-full flex-col">
        <Link
          href={`/shop/${encodeURIComponent(product.slug)}`}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <div className="relative aspect-[4/5] overflow-hidden bg-muted" data-testid="card-media">
            {first ? (
              <Image
                src={first.url}
                alt={pick(first.alt, locale) || title}
                fill
                sizes={SIZES}
                className={cn("object-cover mix-blend-multiply", soldOut && "opacity-60")}
              />
            ) : (
              <ImagePlaceholder name={t("home.brand")} />
            )}
            {first && second ? (
              <motion.div
                data-testid="card-second-image"
                aria-hidden
                className="absolute inset-0 hidden bg-muted lg:block"
                initial={false}
                animate={{ opacity: hover ? 1 : 0 }}
                transition={{ duration: reduced ? 0 : 0.35 }}
              >
                <Image src={second.url} alt="" fill sizes={SIZES} className="object-cover mix-blend-multiply" />
              </motion.div>
            ) : null}
          </div>
          <div className="mt-3 space-y-1.5">
            <h3 className="line-clamp-2 min-h-10 text-sm font-medium leading-5">{title}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <span className="flex items-baseline gap-2">
                <span className="font-semibold">
                  <Price halalas={product.price} locale={locale} />
                </span>
                {product.compareAtPrice && product.compareAtPrice > product.price ? (
                  <s className="text-xs text-muted-foreground">
                    <Price halalas={product.compareAtPrice} locale={locale} />
                  </s>
                ) : null}
              </span>
              <span data-testid="card-chips" className="flex flex-wrap items-center gap-1.5">
                <Badge variant={resale ? "preowned" : "new"}>
                  {resale
                    ? t("badge.preowned", { grade: t(`condition.${product.condition}`) })
                    : t("badge.new")}
                </Badge>
                {product.isFeatured ? <Badge variant="featured">{t("badge.featured")}</Badge> : null}
              </span>
            </div>
          </div>
        </Link>
        {favourite ? (
          <FavouriteHeart
            active={favourite.active}
            onToggle={favourite.toggle}
            className="absolute end-2 top-2"
          />
        ) : null}
        <div className="mt-auto pt-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full lg:[@media(hover:hover)]:opacity-0 lg:[@media(hover:hover)]:group-hover:opacity-100 lg:[@media(hover:hover)]:focus-visible:opacity-100"
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
      </div>
    </li>
  );
}
