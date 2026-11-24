"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Price } from "@/components/format";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import type { HomeProduct } from "@/lib/api/public";
import { flyToCart } from "@/lib/cart/fly";
import { addToCart } from "@/lib/cart/store";

/**
 * Mobile buy bar (PROD-02, design-system section 6): price and Add to cart, fixed to the bottom below lg.
 * It appears only while the inline Add to cart button is out of view, so there is never a duplicate on
 * screen. Hidden on desktop, where the buy box itself is sticky. Not rendered for sold-out items.
 */
export function StickyBuyBar({ product, locale }: { product: HomeProduct; locale: Locale }) {
  const t = useTranslations();
  const [show, setShow] = useState(false);
  const soldOut = product.stock <= 0;

  useEffect(() => {
    if (soldOut || typeof IntersectionObserver === "undefined") return;
    const inline = document.querySelector('[data-testid="add-to-cart"]');
    if (!inline) return;
    const io = new IntersectionObserver(([entry]) => setShow(!entry.isIntersecting), { threshold: 0 });
    io.observe(inline);
    return () => io.disconnect();
  }, [soldOut]);

  if (soldOut || !show) return null;
  return (
    <div
      role="region"
      aria-label={t("product.buyBar")}
      data-testid="sticky-buy-bar"
      className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-4 border-t border-border bg-background px-4 py-3 lg:hidden"
    >
      <span className="text-lg font-semibold">
        <Price halalas={product.price} locale={locale} />
      </span>
      <Button
        type="button"
        className="h-11 flex-1 sm:flex-none sm:px-10"
        data-testid="sticky-add"
        onClick={async (e) => {
          const from = e.currentTarget;
          if (await addToCart(product, 1)) flyToCart(from);
        }}
      >
        {t("cart.addToCart")}
      </Button>
    </div>
  );
}
