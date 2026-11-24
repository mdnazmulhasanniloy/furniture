"use client";

import { FavouriteHeart } from "@/components/product/favourite-heart";
import { ProductCard } from "@/components/home/product-card";
import type { Locale } from "@/i18n/routing";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";
import { favouriteIds, toggleFavourite, useFavouritesStore } from "@/lib/favourites/store";

/** ProductCard wired to the favourites store (guest list or account list). */
export function ConnectedProductCard({
  product,
  locale,
}: {
  product: HomeProduct & { isFeatured?: boolean };
  locale: Locale;
}) {
  const server = useAuthStore((s) => s.status === "authenticated" && s.user?.role === "CUSTOMER");
  const active = useFavouritesStore((s) => favouriteIds(s, server).includes(product.id));
  return (
    <ProductCard
      product={product}
      locale={locale}
      favourite={{ active, toggle: () => void toggleFavourite(product) }}
    />
  );
}

/** Heart for the product page (FAV-01). */
export function ProductHeart({ product }: { product: Pick<HomeProduct, "id" | "slug"> }) {
  const server = useAuthStore((s) => s.status === "authenticated" && s.user?.role === "CUSTOMER");
  const active = useFavouritesStore((s) => favouriteIds(s, server).includes(product.id));
  return <FavouriteHeart active={active} onToggle={() => void toggleFavourite(product)} />;
}
