"use client";

import { useEffect } from "react";

import { CartContents } from "@/components/cart/cart-contents";
import { setCartConfig } from "@/lib/cart/store";
import type { CartConfig } from "@/lib/cart/types";

export function CartPage({ config }: { config: CartConfig }) {
  useEffect(() => setCartConfig(config), [config]);
  return (
    <main className="mx-auto flex max-w-3xl flex-col px-4 py-8">
      <CartContents variant="page" />
    </main>
  );
}
