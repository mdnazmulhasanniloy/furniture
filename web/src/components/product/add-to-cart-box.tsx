"use client";

import { PurchaseBox } from "@/components/product/purchase-box";
import type { Locale } from "@/i18n/routing";
import type { HomeProduct } from "@/lib/api/public";
import { flyToCart } from "@/lib/cart/fly";
import { addToCart } from "@/lib/cart/store";

/** Wires the PROD-02 purchase box to the cart store (T-036). */
export function AddToCartBox({ product, locale }: { product: HomeProduct; locale: Locale }) {
  return (
    <PurchaseBox
      stock={product.stock}
      locale={locale}
      onAdd={async (qty) => {
        const from = document.querySelector('[data-testid="add-to-cart"]');
        if (await addToCart(product, qty)) flyToCart(from);
      }}
    />
  );
}
