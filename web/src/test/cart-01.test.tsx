// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
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
import { configureApiClient } from "@/lib/api/client";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";
import { GUEST_KEY } from "@/lib/cart/guest";
import {
  addToCart,
  hydrateGuest,
  resetCartStore,
  setLineQty,
  syncAfterLogin,
  useCartStore,
} from "@/lib/cart/store";
import type { ServerCart } from "@/lib/cart/types";

type L = "en" | "ar";
const messages = { en, ar } as const;
const wrap = (locale: L, ui: React.ReactNode) => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
};

const ID1 = "a".repeat(24);
const ID2 = "b".repeat(24);
const sofa: HomeProduct = {
  id: ID1, slug: "sofa", title: { en: "Oak sofa", ar: "أريكة بلوط" },
  type: "NEW", condition: "NEW", price: 129950, stock: 3, images: [],
};
const chair: HomeProduct = { ...sofa, id: ID2, slug: "chair", title: { en: "Chair", ar: "كرسي" }, price: 10000, stock: 1 };

const vat0 = { vatRate: 0, vatAmount: 0, applyToDelivery: true, pricesIncludeVat: true };
const cartOf = (over: Partial<ServerCart> = {}): ServerCart => ({
  items: [{ product: sofa, qty: 2, lineTotal: 259900, issue: null }],
  subtotal: 259900, deliveryFee: 0, vat: vat0, total: 259900, ...over,
});

type Call = { path: string; method: string; body: unknown };
let calls: Call[] = [];
function mockApi(handler: (c: Call) => { status?: number; body: unknown }) {
  calls = [];
  configureApiClient({
    getLocale: () => "en",
    fetch: (async (url: string, init: RequestInit) => {
      const c = {
        path: String(url).replace(/^.*\/api\/v1/, ""),
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(c);
      const r = handler(c);
      return new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });
}
const login = () =>
  useAuthStore.setState({
    status: "authenticated", accessToken: "t",
    user: { id: "u", firstName: "A", lastName: "B", email: "a@b.c", role: "CUSTOMER", isVerified: true, isBlocked: false, preferredLocale: "en" },
  });

beforeEach(() => {
  window.localStorage.clear();
  resetCartStore();
  useAuthStore.getState().clear();
});
afterEach(() => {
  cleanup();
  configureApiClient(null);
});

for (const locale of ["en", "ar"] as const) {
  const m = messages[locale];
  describe(`CART-01 · cart (${locale})`, () => {
    it(`CART-01 · guest cart keeps only ids and qty in localStorage, capped at stock (${locale})`, async () => {
      await act(async () => {
        await addToCart(sofa, 2);
        await addToCart(sofa, 5); // 2 + 5 > stock 3
      });
      const raw = JSON.parse(window.localStorage.getItem(GUEST_KEY) as string);
      expect(raw).toEqual([{ productId: ID1, slug: "sofa", qty: 3 }]);
      wrap(locale, <CartButton />);
      expect(screen.getByTestId("cart-count").textContent).toContain("3");
      expect(screen.getByRole("link", { name: m.nav.cart }).getAttribute("href")).toBe("/cart");
    });

    it(`CART-01 · header cart opens the drawer and Escape closes it (${locale})`, async () => {
      mockApi((c) => ({ body: { product: sofa }, status: c.path.startsWith("/products/") ? 200 : 404 }));
      await act(async () => { await addToCart(sofa, 1); });
      wrap(locale, <CartButton />);
      // addToCart opened the drawer; close it, then reopen with the header link.
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByTestId("cart-drawer")).toBeNull());
      fireEvent.click(screen.getByTestId("cart-link"));
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByText(locale === "en" ? "Oak sofa" : "أريكة بلوط")).toBeTruthy();
      expect(screen.getByTestId("cart-guest-note").textContent).toBe(m.cart.guestNote);
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByTestId("cart-drawer")).toBeNull());
    });

    it(`CART-01 · merge on login clears localStorage only after a successful merge (${locale})`, async () => {
      window.localStorage.setItem(GUEST_KEY, JSON.stringify([{ productId: ID1, slug: "sofa", qty: 2 }]));
      login();
      mockApi((c) =>
        c.path === "/cart/merge" ? { body: cartOf() } : { body: cartOf() },
      );
      await act(async () => { await syncAfterLogin(); });
      expect(calls.find((c) => c.path === "/cart/merge")?.body).toEqual({ items: [{ productId: ID1, qty: 2 }] });
      expect(window.localStorage.getItem(GUEST_KEY)).toBeNull();
      expect(useCartStore.getState().cart?.subtotal).toBe(259900);
    });

    it(`CART-01 · a failed merge keeps the local cart and offers a retry (${locale})`, async () => {
      window.localStorage.setItem(GUEST_KEY, JSON.stringify([{ productId: ID1, slug: "sofa", qty: 2 }]));
      login();
      let fail = true;
      mockApi((c) =>
        c.path === "/cart/merge" && fail
          ? { status: 500, body: { code: "INTERNAL_ERROR", message: "boom" } }
          : { body: cartOf() },
      );
      await act(async () => { await syncAfterLogin(); });
      expect(window.localStorage.getItem(GUEST_KEY)).not.toBeNull();
      wrap(locale, <CartContents variant="page" />);
      expect(screen.getByTestId("cart-merge-error").textContent).toContain(m.cart.mergeError);
      expect(screen.queryByText("boom")).toBeNull(); // API message is never shown
      fail = false;
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: m.cart.retry })); });
      await waitFor(() => expect(window.localStorage.getItem(GUEST_KEY)).toBeNull());
    });

    it(`CART-01 · server totals are shown as returned: free delivery, no VAT line at 0 (${locale})`, () => {
      login();
      useCartStore.setState({ cart: cartOf() });
      wrap(locale, <CartContents variant="page" />);
      expect(screen.getByTestId("cart-delivery").textContent).toBe(m.cart.freeDelivery);
      expect(screen.queryByTestId("cart-vat")).toBeNull();
      expect(screen.getByTestId("cart-total").textContent).toMatch(/2,599/);
      expect(screen.getByTestId("cart-checkout").getAttribute("href")).toBe("/checkout");
    });

    it(`CART-01 · VAT line appears only when vatRate > 0 and the fee is the API's (${locale})`, () => {
      login();
      useCartStore.setState({
        cart: cartOf({ deliveryFee: 2500, vat: { vatRate: 15, vatAmount: 39000, pricesIncludeVat: true }, total: 262400 }),
      });
      wrap(locale, <CartContents variant="page" />);
      expect(screen.getByTestId("cart-vat").textContent).toMatch(/390/);
      expect(screen.getByTestId("cart-delivery").textContent).toMatch(/25/);
      expect(screen.getByTestId("cart-total").textContent).toMatch(/2,624/);
    });

    it(`CART-01 · VAT label says included or added from pricesIncludeVat, and vatRate 0 hides it even when the toggle is on (${locale})`, () => {
      login();
      useCartStore.setState({
        cart: cartOf({ deliveryFee: 2500, vat: { vatRate: 15, vatAmount: 39000, pricesIncludeVat: true }, total: 262400 }),
      });
      wrap(locale, <CartContents variant="page" />);
      expect(screen.getByTestId("cart-vat").parentElement?.textContent).toContain(m.cart.vatIncluded.replace("{rate}", "15"));
      cleanup();
      useCartStore.setState({
        cart: cartOf({ deliveryFee: 2500, vat: { vatRate: 15, vatAmount: 39000, pricesIncludeVat: false }, total: 301400 }),
      });
      wrap(locale, <CartContents variant="page" />);
      expect(screen.getByTestId("cart-vat").parentElement?.textContent).toContain(m.cart.vatAdded.replace("{rate}", "15"));
      expect(screen.getByTestId("cart-total").textContent).toMatch(/3,014/);
      cleanup();
      useCartStore.setState({ cart: cartOf({ vat: { vatRate: 0, vatAmount: 0, pricesIncludeVat: true } }) });
      wrap(locale, <CartContents variant="page" />);
      expect(screen.queryByTestId("cart-vat")).toBeNull();
    });

    it(`CART-01 · a non-zero fee is shown as a price, not as Free delivery (${locale})`, () => {
      login();
      useCartStore.setState({ cart: cartOf({ deliveryFee: 5000, total: 264900 }) });
      wrap(locale, <CartContents variant="page" />);
      expect(screen.getByTestId("cart-delivery").textContent).not.toBe(m.cart.freeDelivery);
      expect(screen.getByTestId("cart-delivery").textContent).toMatch(/50/);
    });

    it(`CART-01 · line issues and old vs new price are rendered (${locale})`, () => {
      login();
      useCartStore.setState({
        cart: cartOf({
          items: [
            { product: sofa, qty: 1, lineTotal: 129950, issue: "PRICE_CHANGED", details: { oldPrice: 100000, newPrice: 129950 } },
            { product: chair, qty: 0, lineTotal: 0, issue: "OUT_OF_STOCK" },
          ],
        }),
      });
      wrap(locale, <CartContents variant="page" />);
      const issues = screen.getAllByTestId("cart-issue").map((e) => e.textContent ?? "");
      expect(issues[0]).toMatch(/1,000/);
      expect(issues[0]).toMatch(/1,299/);
      expect(issues[1]).toBe(m.cart.issue.OUT_OF_STOCK);
    });

    it(`CART-01 · free-delivery progress only when a threshold is set (${locale})`, () => {
      login();
      useCartStore.setState({ cart: cartOf({ subtotal: 100000, total: 100000 }) });
      const { unmount } = wrap(locale, <CartContents variant="page" />);
      expect(screen.queryByTestId("cart-free-progress")).toBeNull();
      unmount();
      useCartStore.setState({ config: { freeDeliveryThreshold: 150000, hasCityFeeOverride: false } });
      wrap(locale, <CartContents variant="page" />);
      expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("67");
      expect(screen.getByTestId("cart-free-progress").textContent).toMatch(/500/);
    });

    it(`CART-01 · an undeliverable city shows the message and disables checkout (${locale})`, () => {
      login();
      useCartStore.setState({ cart: cartOf({ address: { id: "x", cityCode: "zz", isDeliverable: false } }) });
      wrap(locale, <CartContents variant="page" />);
      expect(screen.getByTestId("cart-not-deliverable").textContent).toBe(m.cart.notDeliverable);
      expect(screen.getByTestId("cart-checkout").getAttribute("aria-disabled")).toBe("true");
    });

    it(`CART-01 · server writes retry once on CART_CONFLICT and cap qty at stock (${locale})`, async () => {
      login();
      let n = 0;
      mockApi((c) => {
        if (c.method === "PUT") {
          n += 1;
          return n === 1 ? { status: 409, body: { code: "CART_CONFLICT" } } : { body: cartOf() };
        }
        return { body: cartOf() };
      });
      await act(async () => { await addToCart(sofa, 10); });
      const puts = calls.filter((c) => c.method === "PUT");
      expect(puts).toHaveLength(2);
      expect(puts[1].body).toEqual({ productId: ID1, qty: 3 });
      await act(async () => { await setLineQty(ID1, 9, 3); });
      expect(calls.filter((c) => c.method === "PUT").at(-1)?.body).toEqual({ productId: ID1, qty: 3 });
    });

    it(`CART-01 · OUT_OF_STOCK from the API shows a localised message (${locale})`, async () => {
      login();
      mockApi(() => ({ status: 409, body: { code: "OUT_OF_STOCK", message: "English only" } }));
      await act(async () => { await addToCart(sofa, 1); });
      wrap(locale, <CartContents variant="page" />);
      expect(screen.getByTestId("cart-error").textContent).toBe(m.errors.OUT_OF_STOCK);
    });

    it(`CART-01 · empty cart shows the empty state (${locale})`, () => {
      hydrateGuest();
      wrap(locale, <CartContents variant="page" />);
      expect(screen.getByTestId("cart-empty").textContent).toContain(m.cart.empty);
    });
  });
}
