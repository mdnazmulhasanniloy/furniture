"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect } from "react";
import { toast } from "sonner";

import { ImagePlaceholder } from "@/components/brand";
import { Price } from "@/components/format";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { errorMessageKey } from "@/lib/api/errors";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";
import {
  cartCount,
  resolveGuestProducts,
  setLineQty,
  syncAfterLogin,
  useCartStore,
} from "@/lib/cart/store";
import type { CartIssue } from "@/lib/cart/types";
import { formatNumber, formatPrice } from "@/lib/format";
import { pick } from "@/lib/pick";

type Line = {
  key: string;
  productId: string | null;
  product: HomeProduct | null;
  qty: number;
  lineTotal: number;
  issue: CartIssue | null;
  details: { oldPrice: number; newPrice: number } | null;
  loading: boolean;
};

const EMPTY: Line[] = [];

function useLines(server: boolean): Line[] {
  const cart = useCartStore((s) => s.cart);
  const guest = useCartStore((s) => s.guest);
  const guestProducts = useCartStore((s) => s.guestProducts);
  if (server) {
    return (
      cart?.items.map((i, n) => ({
        key: i.product?.id ?? `gone-${n}`,
        productId: i.product?.id ?? null,
        product: i.product,
        qty: i.qty,
        lineTotal: i.lineTotal,
        issue: i.issue ?? (i.product ? null : "UNAVAILABLE"),
        details: i.details ?? null,
        loading: false,
      })) ?? EMPTY
    );
  }
  return guest.map((l) => {
    const p = guestProducts[l.productId];
    const known = l.productId in guestProducts;
    const soldOut = !!p && p.stock <= 0;
    return {
      key: l.productId,
      productId: l.productId,
      product: p ?? null,
      qty: l.qty,
      // Guest display only: no cart API exists for guests (see task assumptions).
      lineTotal: p && !soldOut ? p.price * l.qty : 0,
      issue: known ? (p === null ? "UNAVAILABLE" : soldOut ? "OUT_OF_STOCK" : null) : null,
      details: null,
      loading: !known,
    } satisfies Line;
  });
}

/** Shared by the drawer and the /cart page (W-04). */
export function CartContents({ variant, onNavigate }: { variant: "drawer" | "page"; onNavigate?: () => void }) {
  const t = useTranslations("cart");
  const te = useTranslations("errors");
  const locale = useLocale() as Locale;
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const server = status === "authenticated" && user?.role === "CUSTOMER";
  const cart = useCartStore((s) => s.cart);
  const guest = useCartStore((s) => s.guest);
  const loading = useCartStore((s) => s.loading);
  const error = useCartStore((s) => s.error);
  const mergeFailed = useCartStore((s) => s.mergeFailed);
  const config = useCartStore((s) => s.config);
  const lines = useLines(server);

  useEffect(() => {
    if (!server) void resolveGuestProducts();
  }, [server, guest]);

  const effective = lines.filter((l) => !l.loading && l.issue !== "UNAVAILABLE" && l.issue !== "OUT_OF_STOCK" && l.product);
  const guestSubtotal = effective.reduce((n, l) => n + l.lineTotal, 0);
  const subtotal = server ? (cart?.subtotal ?? 0) : guestSubtotal;
  const threshold = config.freeDeliveryThreshold && config.freeDeliveryThreshold > 0 ? config.freeDeliveryThreshold : null;
  const notDeliverable = server && cart?.address?.isDeliverable === false;
  const canCheckout = effective.length > 0 && !notDeliverable;
  const count = cartCount({ cart, guest }, server);
  const vat = server ? cart?.vat : null;
  const headingLevel = variant === "page" ? "h1" : "h2";
  const Heading = headingLevel;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid={`cart-${variant}`}>
      <div className="flex items-baseline justify-between gap-2">
        <Heading id={variant === "drawer" ? "cart-drawer-title" : undefined} className="font-display text-xl font-semibold">
          {t("title")}
        </Heading>
        {count > 0 ? (
          <span className="text-sm text-muted-foreground">{t("itemsCount", { count })}</span>
        ) : null}
      </div>

      {mergeFailed ? (
        <div role="alert" className="rounded-md border border-border bg-muted p-3 text-sm" data-testid="cart-merge-error">
          <p>{t("mergeError")}</p>
          <button type="button" className="mt-2 font-medium text-primary underline" onClick={() => void syncAfterLogin()}>
            {t("retry")}
          </button>
        </div>
      ) : error ? (
        <p role="alert" className="rounded-md border border-border bg-muted p-3 text-sm text-destructive" data-testid="cart-error">
          {te(errorMessageKey(error))}
        </p>
      ) : null}

      {loading && lines.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">{t("loading")}</p>
      ) : lines.length === 0 ? (
        <div className="py-8 text-center" data-testid="cart-empty">
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
          <Link href="/shop" onClick={onNavigate} className="mt-3 inline-block text-sm font-medium text-primary underline">
            {t("continueShopping")}
          </Link>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" data-testid="cart-lines">
          {lines.map((l) => (
            <LineRow key={l.key} line={l} locale={locale} />
          ))}
        </ul>
      )}

      {lines.length > 0 ? (
        <>
        <div
          className={`space-y-2 text-sm ${variant === "page" ? "border-t border-border pt-4" : "border-t border-border pt-3"}`}
          data-testid="cart-summary"
        >
          {threshold ? (
            <FreeDeliveryProgress subtotal={subtotal} threshold={threshold} locale={locale} />
          ) : null}
          <Row label={t("subtotal")} value={<Price halalas={subtotal} locale={locale} />} testid="cart-subtotal" />
          {server && cart ? (
            <>
              <Row
                label={t("delivery")}
                value={cart.deliveryFee === 0 ? t("freeDelivery") : <Price halalas={cart.deliveryFee} locale={locale} />}
                testid="cart-delivery"
              />
              {vat && vat.vatRate > 0 ? (
                <Row
                  label={t(vat.pricesIncludeVat ? "vatIncluded" : "vatAdded", { rate: formatNumber(vat.vatRate, locale) })}
                  value={<Price halalas={vat.vatAmount} locale={locale} />}
                  testid="cart-vat"
                />
              ) : null}
              <Row label={t("total")} value={<Price halalas={cart.total} locale={locale} />} testid="cart-total" strong />
              {config.hasCityFeeOverride && !cart.address ? (
                <p className="text-xs text-muted-foreground">{t("deliveryNote")}</p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="cart-guest-note">{t("guestNote")}</p>
          )}
          {notDeliverable ? (
            <p role="alert" className="text-sm text-destructive" data-testid="cart-not-deliverable">
              {t("notDeliverable")}
            </p>
          ) : null}
        </div>
        <div
          data-testid="cart-checkout-bar"
          className={`flex flex-col gap-2 ${variant === "page" ? "max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-4 max-md:border-t max-md:border-border max-md:bg-background max-md:p-4" : ""}`}
        >
            {canCheckout ? (
              <Link
                href={server ? "/checkout" : "/login"}
                onClick={onNavigate}
                data-testid="cart-checkout"
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {server ? t("checkout") : t("loginToCheckout")}
              </Link>
            ) : (
              <span
                aria-disabled="true"
                data-testid="cart-checkout"
                className="inline-flex h-10 cursor-not-allowed items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground opacity-50"
              >
                {t("checkout")}
              </span>
            )}
            {variant === "drawer" ? (
              <Link href="/cart" onClick={onNavigate} className="text-center text-sm text-primary underline">
                {t("viewCart")}
              </Link>
            ) : null}
        </div>
        </>
      ) : null}
    </div>
  );
}

function Row({ label, value, strong, testid }: { label: string; value: React.ReactNode; strong?: boolean; testid: string }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span data-testid={testid}>{value}</span>
    </div>
  );
}

function FreeDeliveryProgress({ subtotal, threshold, locale }: { subtotal: number; threshold: number; locale: Locale }) {
  const t = useTranslations("cart");
  const reached = subtotal >= threshold;
  const pct = Math.min(100, Math.max(0, Math.round((subtotal / threshold) * 100)));
  return (
    <div data-testid="cart-free-progress">
      <p className="mb-1 text-xs">
        {reached ? t("freeDeliveryReached") : t("freeDeliveryIn", { amount: formatPrice(threshold - subtotal, locale) })}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t("freeDeliveryReached")}
        className="h-2 overflow-hidden rounded-full border border-input bg-muted"
      >
        <div className="h-full bg-gold-strong transition-[width] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LineRow({ line, locale }: { line: Line; locale: Locale }) {
  const t = useTranslations();
  const p = line.product;
  const title = p ? pick(p.title, locale) : "";
  const image = p?.images?.[0];
  const unavailable = line.issue === "UNAVAILABLE" || line.issue === "OUT_OF_STOCK";
  const stock = p?.stock ?? 0;

  if (line.loading) {
    return <li className="py-3 text-sm text-muted-foreground" aria-busy="true">{t("cart.loading")}</li>;
  }
  return (
    <li className="flex gap-3 py-3" data-testid="cart-line">
      <div className="relative aspect-[4/5] w-20 shrink-0 overflow-hidden rounded-md bg-muted" data-testid="line-thumb">
        {image ? (
          <Image src={image.url} alt={pick(image.alt, locale) || title} fill sizes="80px" className="object-cover" />
        ) : (
          <ImagePlaceholder name={t("home.brand")} className="[&_[data-testid=wordmark]]:text-xs" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {p ? (
          <Link href={`/shop/${encodeURIComponent(p.slug)}`} className="line-clamp-2 text-sm font-medium hover:underline">
            {title}
          </Link>
        ) : (
          <p className="text-sm font-medium">{t("cart.issue.UNAVAILABLE")}</p>
        )}
        {p ? (
          <p className="text-sm">
            <Price halalas={p.price} locale={locale} />
          </p>
        ) : null}
        {line.issue && p ? (
          <p className="text-xs text-warning-foreground" data-testid="cart-issue">
            {line.issue === "PRICE_CHANGED" && line.details
              ? t("cart.issue.PRICE_CHANGED", {
                  oldPrice: formatPrice(line.details.oldPrice, locale),
                  newPrice: formatPrice(line.details.newPrice, locale),
                })
              : t(`cart.issue.${line.issue}`)}
          </p>
        ) : null}
        {p && line.productId ? (
          <div className="flex items-center gap-2">
            {!unavailable ? (
              <div className="inline-flex items-center rounded-full border border-input" role="group" aria-label={t("product.quantity")}>
                <button
                  type="button"
                  aria-label={t("product.decrease")}
                  disabled={line.qty <= 1}
                  onClick={() => void setLineQty(line.productId as string, line.qty - 1, stock)}
                  className="p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  <Minus className="size-3.5" aria-hidden />
                </button>
                <output className="min-w-6 text-center text-sm" data-testid="line-qty">{formatNumber(line.qty, locale)}</output>
                <button
                  type="button"
                  aria-label={t("product.increase")}
                  disabled={line.qty >= stock}
                  onClick={() => void setLineQty(line.productId as string, line.qty + 1, stock)}
                  className="p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  <Plus className="size-3.5" aria-hidden />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              aria-label={t("cart.remove", { title })}
              onClick={async () => {
                // Remove with undo (CR-007): the toast action puts the same quantity back.
                const productId = line.productId as string;
                const qty = line.qty;
                await setLineQty(productId, 0, stock);
                if (useCartStore.getState().error) return;
                toast(t("cart.removed", { title }), {
                  id: `cart-removed-${productId}`,
                  action: { label: t("cart.undo"), onClick: () => void setLineQty(productId, qty, stock) },
                });
              }}
              className="rounded-md p-1.5 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
      <div className="text-sm font-medium" data-testid="line-total">
        <Price halalas={line.lineTotal} locale={locale} />
      </div>
    </li>
  );
}

