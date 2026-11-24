"use client";

import { useEffect } from "react";

import { CartContents } from "@/components/cart/cart-contents";
import { setCartConfig } from "@/lib/cart/store";
import type { CartConfig } from "@/lib/cart/types";

export function CartPage({ config }: { config: CartConfig }) {
  useEffect(() => setCartConfig(config), [config]);
  return (
    <main className="band mx-auto flex w-full max-w-5xl flex-col px-5 sm:px-8 lg:px-12">
      <CartContents variant="page" />
    </main>
  );
}
