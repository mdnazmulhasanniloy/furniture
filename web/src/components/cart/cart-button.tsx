"use client";

import { ShoppingBag, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { CartContents } from "@/components/cart/cart-contents";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { cartCount, closeDrawer, openDrawer, setCartConfig, useCartStore } from "@/lib/cart/store";
import type { CartConfig } from "@/lib/cart/types";

/** Header cart link (still a real link to /cart) with a count badge; click opens the drawer. */
export function CartButton({ config }: { config?: CartConfig }) {
  const t = useTranslations();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const server = status === "authenticated" && user?.role === "CUSTOMER";
  const count = useCartStore((s) => cartCount(s, server));
  const open = useCartStore((s) => s.drawerOpen);
  const addedTick = useCartStore((s) => s.addedTick);
  const [initialTick] = useState(addedTick);
  const trigger = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (config) setCartConfig(config);
  }, [config]);

  return (
    <>
      <Button asChild variant="ghost" size="icon" data-testid="cart-link" className="relative">
        <Link
          ref={trigger}
          href="/cart"
          aria-label={t("nav.cart")}
          aria-haspopup="dialog"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            openDrawer();
          }}
        >
          <ShoppingBag aria-hidden />
          {count > 0 ? (
            <span
              data-testid="cart-count"
              className="absolute -end-1 -top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-accent-foreground"
            >
              <span aria-hidden>{count > 99 ? "99+" : count}</span>
              <span className="sr-only">{t("cart.badgeLabel", { count })}</span>
            </span>
          ) : null}
        </Link>
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {addedTick !== initialTick ? t("cart.added") : ""}
      </span>
      {open ? (
        <Drawer
          onClose={() => {
            closeDrawer();
            trigger.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  const t = useTranslations("cart");
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-50" data-testid="cart-drawer">
      <button
        type="button"
        aria-label={t("close")}
        tabIndex={-1}
        className="absolute inset-0 bg-foreground/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
        className="absolute inset-y-0 end-0 flex w-96 max-w-[90vw] flex-col gap-3 bg-background p-4 shadow-[var(--shadow-soft)]"
      >
        <div className="flex justify-end">
          <Button ref={closeRef} variant="ghost" size="icon" aria-label={t("close")} onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
        <CartContents variant="drawer" onNavigate={onClose} />
      </div>
    </div>
  );
}
