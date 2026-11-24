"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Locale } from "@/i18n/routing";
import { formatNumber } from "@/lib/format";

/**
 * Quantity stepper + Add to cart. Add-to-cart wiring belongs to T-036 (cart store, fly-to-cart):
 * until then the button is a visibly disabled placeholder for in-stock items (autopilot
 * assumption). Sold out disables it with the "Sold out" label (PROD-02).
 */
export function PurchaseBox({
  stock,
  locale,
  onAdd,
}: {
  stock: number;
  locale: Locale;
  /** T-036 hook: called with the chosen quantity. When absent the button stays disabled. */
  onAdd?: (qty: number) => void;
}) {
  const t = useTranslations();
  const [qty, setQty] = useState(1);
  const soldOut = stock <= 0;

  return (
    <div className="space-y-3">
      {!soldOut ? (
        <div className="flex items-center gap-3">
          <span id="qty-label" className="text-sm font-medium">
            {t("product.quantity")}
          </span>
          <div
            className="inline-flex items-center rounded-sm border border-input"
            role="group"
            aria-labelledby="qty-label"
          >
            <button
              type="button"
              aria-label={t("product.decrease")}
              disabled={qty <= 1}
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <Minus className="size-4" aria-hidden />
            </button>
            <output aria-live="polite" className="min-w-8 text-center text-sm" data-testid="qty">
              {formatNumber(qty, locale)}
            </output>
            <button
              type="button"
              aria-label={t("product.increase")}
              disabled={qty >= stock}
              onClick={() => setQty((q) => Math.min(stock, q + 1))}
              className="p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        data-testid="add-to-cart"
        disabled={soldOut || !onAdd}
        onClick={() => onAdd?.(qty)}
        aria-describedby={!soldOut && !onAdd ? "cart-soon" : undefined}
        className="h-12 w-full rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {soldOut ? t("badge.soldOut") : t("cart.addToCart")}
      </button>
      {!soldOut && !onAdd ? (
        <p id="cart-soon" className="text-xs text-muted-foreground">
          {t("product.cartSoon")}
        </p>
      ) : null}
    </div>
  );
}
