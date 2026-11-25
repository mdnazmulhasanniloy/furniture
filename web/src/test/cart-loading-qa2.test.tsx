// @vitest-environment jsdom
// QA 2026-11-24 item 2: the cart shows one skeleton (lines and summary) until the session and every line are known;
// never SAR 0 or a partial subtotal, and the checkout label never flips.
import { act, cleanup, render, screen } from "@testing-library/react";
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
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }), Toaster: () => null }));
// the guest products are resolved by hand in these tests
vi.mock("@/lib/cart/store", async (orig) => ({ ...(await orig<typeof import("@/lib/cart/store")>()), resolveGuestProducts: vi.fn() }));

import { CartContents } from "@/components/cart/cart-contents";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";
import { resetCartStore, useCartStore } from "@/lib/cart/store";

const messages = { en, ar } as const;
const product = (n: string, price: number): HomeProduct => ({
  id: n.repeat(24), slug: `p-${n}`, title: { en: `Product ${n}`, ar: `منتج ${n}` },
  type: "NEW", condition: "NEW", price, stock: 5, images: [],
});
const A = product("a", 100000);
const B = product("b", 50000);

const show = (locale: "en" | "ar") => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <CartContents variant="page" />
    </NextIntlClientProvider>,
  );
};

beforeEach(() => {
  window.localStorage.clear();
  resetCartStore();
  useAuthStore.getState().clear(); // anonymous
});
afterEach(cleanup);

for (const locale of ["en", "ar"] as const) {
  describe(`QA-2 · cart loading (${locale})`, () => {
    it("shows a skeleton and no subtotal while guest products are loading, then the full subtotal at once", () => {
      useCartStore.setState({
        guest: [{ productId: A.id, slug: A.slug, qty: 1 }, { productId: B.id, slug: B.slug, qty: 2 }],
        guestProducts: { [A.id]: A }, // B is still loading: a partial subtotal would be 1 000
      });
      show(locale);
      expect(screen.getByTestId("cart-skeleton")).toBeTruthy();
      expect(screen.queryByTestId("cart-summary")).toBeNull();
      expect(screen.queryByTestId("cart-subtotal")).toBeNull();
      expect(screen.queryByTestId("cart-checkout")).toBeNull();
      act(() => useCartStore.setState({ guestProducts: { [A.id]: A, [B.id]: B } }));
      expect(screen.queryByTestId("cart-skeleton")).toBeNull();
      expect(screen.getByTestId("cart-subtotal").textContent).toMatch(/2[,٬]?000|٢[,٬]?٠٠٠/); // 1 000 + 2 x 500
      expect(screen.getByTestId("cart-checkout").textContent).toBe(messages[locale].cart.loginToCheckout);
    });

    it("shows the skeleton, not an empty cart or a login label, while the session is unknown", () => {
      useAuthStore.setState({ status: "unknown" });
      useCartStore.setState({ guest: [{ productId: A.id, slug: A.slug, qty: 1 }], guestProducts: { [A.id]: A } });
      show(locale);
      expect(screen.getByTestId("cart-skeleton")).toBeTruthy();
      expect(screen.queryByTestId("cart-checkout")).toBeNull();
      expect(screen.queryByTestId("cart-empty")).toBeNull();
      act(() => useAuthStore.getState().clear());
      expect(screen.queryByTestId("cart-skeleton")).toBeNull();
      expect(screen.getByTestId("cart-checkout")).toBeTruthy();
    });

    it("a signed-in customer sees the skeleton until the server cart arrives, and the label is Checkout from the first paint", () => {
      useAuthStore.setState({
        status: "authenticated", accessToken: "t",
        user: { id: "u", firstName: "A", lastName: "B", email: "a@b.c", role: "CUSTOMER", isVerified: true, isBlocked: false, preferredLocale: "en" },
      });
      show(locale);
      expect(screen.getByTestId("cart-skeleton")).toBeTruthy();
      expect(screen.queryByTestId("cart-subtotal")).toBeNull();
      act(() =>
        useCartStore.setState({
          cart: {
            items: [{ productId: A.id, product: A, qty: 1, lineTotal: 100000, issue: null }],
            subtotal: 100000, deliveryFee: 0, total: 100000,
            vat: { vatRate: 0, vatAmount: 0, applyToDelivery: true, pricesIncludeVat: true },
          },
        }),
      );
      expect(screen.queryByTestId("cart-skeleton")).toBeNull();
      expect(screen.getByTestId("cart-checkout").textContent).toBe(messages[locale].cart.checkout);
    });
  });
}
