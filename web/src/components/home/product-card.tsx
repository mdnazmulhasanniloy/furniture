"use client";

import { motion } from "framer-motion";
import { ShoppingBag } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useState } from "react";

import { ImagePlaceholder } from "@/components/brand";
import { Price } from "@/components/format";
import { FavouriteHeart } from "@/components/product/favourite-heart";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { HomeProduct } from "@/lib/api/public";
import { flyToCart } from "@/lib/cart/fly";
import { addToCart } from "@/lib/cart/store";
import { formatPercent } from "@/lib/format";
import { pick } from "@/lib/pick";
import { useMotionPrefs } from "@/lib/use-motion-prefs";
import { cn } from "@/lib/utils";

const SIZES = "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 50vw";

/**
 * Product tile (PROD-01, UI-04). The photo (8 px corners, zooms on hover and focus) carries the heart in its top-end
 * corner and the quick-add control on its bottom edge, so nothing in the text block ever moves:
 * - hover-capable screens: a full-width "Add to cart" bar that fades in on hover or focus, on EVERY card;
 * - touch screens: always visible, as a round bag button (same accessible name).
 * Under the photo: the title (body face), then the price with at most ONE badge, chosen by priority:
 * sold out, then the condition grade of a pre-owned piece, then the percentage off. There is no "New" badge (it says
 * nothing on a new piece) and no "Featured" badge. The second image crossfades on hover (off under reduced motion).
 */
export function ProductCard({
  product,
  locale,
  favourite,
}: {
  product: HomeProduct;
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
  const onSale = !!product.compareAtPrice && product.compareAtPrice > product.price;
  const off = onSale ? Math.round(((product.compareAtPrice! - product.price) / product.compareAtPrice!) * 100) : 0;
  const href = `/shop/${encodeURIComponent(product.slug)}`;
  const addLabel = soldOut ? t("badge.soldOut") : t("cart.addToCart");

  const badge = soldOut ? (
    <Badge variant="soldOut">{t("badge.soldOut")}</Badge>
  ) : resale ? (
    <Badge variant="preowned">{t("badge.preowned", { grade: t(`condition.${product.condition}`) })}</Badge>
  ) : off > 0 ? (
    // same outlined style as the old "Featured" chip; the text is only a number, so it needs no copy
    <Badge variant="featured" data-testid="sale-badge">
      <bdi>{`−${formatPercent(off / 100, locale)}`}</bdi>
    </Badge>
  ) : null;

  return (
    <li>
      <div
        data-testid="product-card"
        className="group relative flex h-full flex-col"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        <div className="relative">
          <Link href={href} tabIndex={-1} aria-hidden className="zoom-on-hover block">
            <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-muted" data-testid="card-media">
              {first ? (
                <Image
                  src={first.url}
                  alt={pick(first.alt, locale) || title}
                  fill
                  sizes={SIZES}
                  quality={60}
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
                  <Image src={second.url} alt="" fill sizes={SIZES} quality={60} className="object-cover mix-blend-multiply" />
                </motion.div>
              ) : null}
            </div>
          </Link>
          {favourite ? (
            <FavouriteHeart active={favourite.active} onToggle={favourite.toggle} className="absolute end-2 top-2" />
          ) : null}
          <button
            type="button"
            data-testid="quick-add"
            aria-label={addLabel}
            disabled={soldOut}
            onClick={async (e) => {
              const from = e.currentTarget;
              if (await addToCart(product, 1)) flyToCart(from);
            }}
            className={cn(
              "absolute bottom-2 end-2 flex size-10 items-center justify-center rounded-full bg-card text-foreground shadow-float focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60",
              "[@media(hover:hover)]:inset-x-2 [@media(hover:hover)]:h-10 [@media(hover:hover)]:w-auto [@media(hover:hover)]:rounded-md [@media(hover:hover)]:bg-primary [@media(hover:hover)]:px-4 [@media(hover:hover)]:text-sm [@media(hover:hover)]:font-medium [@media(hover:hover)]:text-primary-foreground [@media(hover:hover)]:shadow-none",
              "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
              "[@media(hover:hover)]:disabled:bg-card [@media(hover:hover)]:disabled:text-foreground",
            )}
          >
            <ShoppingBag aria-hidden className="size-5 [@media(hover:hover)]:hidden" />
            <span className="hidden [@media(hover:hover)]:inline">{addLabel}</span>
          </button>
        </div>
        <div className="mt-3 space-y-1">
          <h3 className="line-clamp-2 text-base font-semibold leading-6">
            <Link href={href} className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {title}
            </Link>
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-base">
            <span className="flex items-baseline gap-2">
              <span className="font-semibold">
                <Price halalas={product.price} locale={locale} />
              </span>
              {onSale ? (
                <s className="text-sm text-muted-foreground">
                  <Price halalas={product.compareAtPrice as number} locale={locale} />
                </s>
              ) : null}
            </span>
            {badge ? (
              <span data-testid="card-chips" className="flex flex-wrap items-center gap-1.5">
                {badge}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
