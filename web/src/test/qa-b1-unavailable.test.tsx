// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import { CartButton } from "@/components/cart/cart-button";
import { CartContents } from "@/components/cart/cart-contents";
import { FavouritesLink } from "@/components/favourites/favourites-link";
import { configureApiClient } from "@/lib/api/client";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";
import { GUEST_KEY } from "@/lib/cart/guest";
import { hydrateGuest, loadCart, resetCartStore, resolveGuestProducts, useCartStore } from "@/lib/cart/store";
import type { ServerCart } from "@/lib/cart/types";
import { GUEST_FAV_KEY, readGuestFavourites } from "@/lib/favourites/guest";
import { hydrateGuestFavourites, resetFavouritesStore, resolveGuestFavourites } from "@/lib/favourites/store";

/**
 * QA 2026-11-24 (B1). A "No longer available" line could not be removed and was still counted: the
 * cart response carried no productId for it (B-035) and the API refused `qty: 0` for a product that
 * was gone. The line now has a remove button, is left out of the count and the totals, and blocks
 * checkout until it is gone. The guest stores (cart and favourites, both localStorage) drop a product
 * that answers 404 by themselves, so no badge can count something that no longer exists.
 */
const messages = { en, ar } as const;
const wrap = (locale: "en" | "ar", ui: React.ReactNode) => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
};

const LIVE = "a".repeat(24);
const GONE = "b".repeat(24);
const sofa: HomeProduct = {
  id: LIVE,
  slug: "sofa",
  title: { en: "Oak sofa", ar: "أريكة بلوط" },
  type: "NEW",
  condition: "NEW",
  price: 100000,
  stock: 3,
  images: [],
};
const vat0 = { vatRate: 0, vatAmount: 0, applyToDelivery: true, pricesIncludeVat: true };
/** What the API answers: the gone line keeps its productId and carries no product. */
const cartWithGone = (): ServerCart => ({
  items: [
    { productId: LIVE, product: sofa, qty: 1, lineTotal: 100000, issue: null },
    { productId: GONE, product: null, qty: 0, lineTotal: 0, issue: "UNAVAILABLE" },
  ],
  subtotal: 100000,
  deliveryFee: 0,
  vat: vat0,
  total: 100000,
});

type Call = { path: string; method: string; body: unknown };
let calls: Call[] = [];
let serverCart: ServerCart = cartWithGone();
function mockApi(extra?: (c: Call) => { status?: number; body: unknown } | undefined) {
  calls = [];
  configureApiClient({
    getLocale: () => "en",
    fetch: (async (url: string, init: RequestInit) => {
      const c: Call = {
        path: String(url).replace(/^.*\/api\/v1/, ""),
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(c);
      const own = extra?.(c);
      const r = own ?? { body: {}, status: 404 };
      if (!own) {
        if (c.path.startsWith("/cart") && c.method === "GET") Object.assign(r, { status: 200, body: serverCart });
        if (c.path === "/cart/items" && c.method === "PUT") {
          const body = c.body as { productId: string; qty: number };
          if (body.qty === 0) serverCart = { ...serverCart, items: serverCart.items.filter((i) => i.productId !== body.productId) };
          Object.assign(r, { status: 200, body: serverCart });
        }
      }
      return new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });
}
const login = () =>
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "t",
    user: { id: "u", firstName: "A", lastName: "B", email: "a@b.c", role: "CUSTOMER", isVerified: true, isBlocked: false, preferredLocale: "en" },
  });

beforeEach(() => {
  window.localStorage.clear();
  resetCartStore();
  resetFavouritesStore();
  useAuthStore.getState().clear();
  serverCart = cartWithGone();
});
afterEach(() => {
  cleanup();
  configureApiClient(null);
});

for (const locale of ["en", "ar"] as const) {
  const m = messages[locale];

  describe(`CART-01 · an unavailable line can be removed (${locale}) (B1)`, () => {
    it(`CART-01 · it shows a remove button, is not counted, and blocks checkout (${locale})`, async () => {
      mockApi();
      login();
      await act(async () => {
        await loadCart();
      });
      wrap(locale, <CartContents variant="page" />);

      expect(screen.getAllByTestId("cart-line")).toHaveLength(2);
      expect(screen.getByText(m.cart.issue.UNAVAILABLE)).toBeTruthy();
      // one item, not two: the gone line is not counted
      expect(screen.getByTestId("cart-items-count").textContent).toContain("1");
      // checkout is blocked and says why, with the approved wording
      expect(screen.getByTestId("cart-checkout").getAttribute("aria-disabled")).toBe("true");
      expect(screen.getByTestId("cart-blocked").textContent).toBe(m.checkout.reviewIssue);

      const remove = screen.getByTestId("cart-remove-unavailable");
      await act(async () => {
        fireEvent.click(remove);
      });
      const put = calls.find((c) => c.path === "/cart/items" && c.method === "PUT");
      expect(put?.body).toEqual({ productId: GONE, qty: 0 });
      await waitFor(() => expect(screen.getAllByTestId("cart-line")).toHaveLength(1));
      expect(screen.queryByTestId("cart-blocked")).toBeNull();
      expect(screen.getByTestId("cart-checkout").getAttribute("aria-disabled")).toBeNull();
    });

    it(`CART-01 · the header badge counts only the lines that are still there (${locale})`, async () => {
      mockApi();
      login();
      await act(async () => {
        await loadCart();
      });
      wrap(locale, <CartButton />);
      expect(screen.getByTestId("cart-count").textContent).toContain("1");
    });
  });

  describe(`CART-01 · guest stores drop a product that 404s (${locale}) (B1)`, () => {
    it(`CART-01 · a guest cart line for a deleted product leaves the store and the badge (${locale})`, async () => {
      window.localStorage.setItem(
        GUEST_KEY,
        JSON.stringify([
          { productId: LIVE, slug: "sofa", qty: 2 },
          { productId: GONE, slug: "gone", qty: 1 },
        ]),
      );
      mockApi((c) =>
        c.path === `/products/sofa` ? { body: { product: sofa } } : c.path === `/products/gone` ? { status: 404, body: { code: "NOT_FOUND" } } : undefined,
      );
      hydrateGuest();
      await act(async () => {
        await resolveGuestProducts();
      });
      expect(JSON.parse(window.localStorage.getItem(GUEST_KEY) as string)).toEqual([
        { productId: LIVE, slug: "sofa", qty: 2 },
      ]);
      expect(useCartStore.getState().guest).toHaveLength(1);
      wrap(locale, <CartButton />);
      expect(screen.getByTestId("cart-count").textContent).toContain("2"); // not 3
      expect(useCartStore.getState().error).toBeNull();
    });

    it(`CART-01 · a guest favourite for a deleted product leaves the store and the badge (${locale})`, async () => {
      window.localStorage.setItem(
        GUEST_FAV_KEY,
        JSON.stringify([
          { productId: LIVE, slug: "sofa" },
          { productId: GONE, slug: "gone" },
        ]),
      );
      mockApi((c) =>
        c.path === `/products/sofa` ? { body: { product: sofa } } : c.path === `/products/gone` ? { status: 404, body: { code: "NOT_FOUND" } } : undefined,
      );
      hydrateGuestFavourites();
      await act(async () => {
        await resolveGuestFavourites();
      });
      expect(readGuestFavourites()).toEqual([{ productId: LIVE, slug: "sofa" }]);
      wrap(locale, <FavouritesLink />);
      expect(screen.getByTestId("favourites-count").textContent).toBe("1");
    });
  });
}
