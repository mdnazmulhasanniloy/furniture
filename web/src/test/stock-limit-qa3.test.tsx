// @vitest-environment jsdom
// QA 2026-11-24 item 3: adding more than the live stock must not claim "Added to cart".
// Repro from the report: stock 3, add 3, then add 3 again -> an error naming what is available, and nothing added.
import { act, cleanup, render } from "@testing-library/react";
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
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast, Toaster: () => null }));
vi.mock("@/lib/cart/fly", () => ({ flyToCart: vi.fn() }));

import { CartButton } from "@/components/cart/cart-button";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";
import { addToCart, cartCount, resetCartStore, useCartStore } from "@/lib/cart/store";
import { formatNumber } from "@/lib/format";

const messages = { en, ar } as const;
const sofa: HomeProduct = {
  id: "a".repeat(24), slug: "milano-corner-sofa",
  title: { en: "Milano L-Shaped Corner Sofa", ar: "أريكة ميلانو" },
  type: "NEW", condition: "NEW", price: 500000, stock: 3, images: [],
};

const mount = (locale: "en" | "ar") =>
  render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <CartButton />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  window.localStorage.clear();
  resetCartStore();
  useAuthStore.getState().clear(); // guest cart: no API needed
  toast.success.mockClear();
  toast.error.mockClear();
});
afterEach(cleanup);

for (const locale of ["en", "ar"] as const) {
  describe(`QA-3 · stock limit on add to cart (${locale})`, () => {
    it("the first add of the whole stock succeeds and says so", async () => {
      mount(locale);
      await act(async () => {
        expect(await addToCart(sofa, 3)).toBe(true);
      });
      expect(cartCount(useCartStore.getState(), false)).toBe(3);
      expect(toast.success).toHaveBeenCalledWith(messages[locale].cart.added, expect.anything());
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("a second add is refused, names what is available, and changes nothing", async () => {
      mount(locale);
      await act(async () => {
        await addToCart(sofa, 3);
      });
      toast.success.mockClear();
      await act(async () => {
        expect(await addToCart(sofa, 3)).toBe(false); // the repro
      });
      expect(cartCount(useCartStore.getState(), false)).toBe(3); // nothing added
      expect(toast.success).not.toHaveBeenCalled(); // never "Added to cart"
      const [message] = toast.error.mock.calls.at(-1)!;
      const expected = messages[locale].cart.stockLimit
        .replace("{stock}", formatNumber(3, locale))
        .replace("{inCart}", formatNumber(3, locale));
      expect(message).toBe(expected);
    });

    it("one more than the remaining stock is refused; exactly the remainder is accepted", async () => {
      mount(locale);
      await act(async () => {
        await addToCart(sofa, 2);
      });
      await act(async () => {
        expect(await addToCart(sofa, 2)).toBe(false); // 2 + 2 > 3
      });
      expect(cartCount(useCartStore.getState(), false)).toBe(2);
      await act(async () => {
        expect(await addToCart(sofa, 1)).toBe(true); // 2 + 1 = 3
      });
      expect(cartCount(useCartStore.getState(), false)).toBe(3);
    });

    it("each refusal is announced again, not swallowed as a repeat", async () => {
      mount(locale);
      await act(async () => {
        await addToCart(sofa, 3);
      });
      await act(async () => {
        await addToCart(sofa, 1);
      });
      await act(async () => {
        await addToCart(sofa, 1);
      });
      expect(toast.error).toHaveBeenCalledTimes(2);
    });
  });
}
