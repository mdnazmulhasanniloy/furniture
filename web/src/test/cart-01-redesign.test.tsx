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
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => <img src={src} alt={alt} className={className} />,
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn() }));
vi.mock("sonner", () => ({ toast, Toaster: () => null }));

import { CartButton } from "@/components/cart/cart-button";
import { CartContents } from "@/components/cart/cart-contents";
import { configureApiClient } from "@/lib/api/client";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";
import { addToCart, resetCartStore, useCartStore } from "@/lib/cart/store";
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
const sofa: HomeProduct = {
  id: ID1, slug: "sofa", title: { en: "Oak sofa with a long name that wraps", ar: "أريكة بلوط باسم طويل يلتف على سطرين" },
  type: "NEW", condition: "NEW", price: 129950, stock: 3, images: [],
};
const vat0 = { vatRate: 0, vatAmount: 0, applyToDelivery: true, pricesIncludeVat: true };
const cartOf = (over: Partial<ServerCart> = {}, product: HomeProduct = sofa): ServerCart => ({
  items: [{ productId: product.id, product, qty: 2, lineTotal: 259900, issue: null }],
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
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
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
  toast.mockClear();
  toast.success.mockClear();
});
afterEach(() => {
  cleanup();
  configureApiClient(null);
});

describe.each(["en", "ar"] as const)("CART-01 · redesigned cart (%s)", (locale) => {
  const m = messages[locale];
  const titleOf = (p: HomeProduct) => p.title[locale] ?? "";

  it(`CART-01 · adding shows a toast with a View cart action and does not force the drawer open (${locale})`, async () => {
    wrap(locale, <CartButton />);
    await act(async () => {
      await addToCart(sofa, 1);
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const [message, opts] = toast.success.mock.calls[0]!;
    expect(message).toBe(m.cart.added);
    expect(opts.action.label).toBe(m.cart.viewCart);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => opts.action.onClick());
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it(`CART-01 · the drawer slides in from the end side: right in LTR, left in RTL (${locale})`, async () => {
    useCartStore.setState({ drawerOpen: true });
    wrap(locale, <CartButton />);
    const panel = (await screen.findByRole("dialog")) as HTMLElement;
    // The slide is already under way; only its direction (sign) is stable.
    const x = Number(/translateX\((-?[\d.]+)%\)/.exec(panel.style.transform)?.[1] ?? "NaN");
    expect(Math.sign(x)).toBe(locale === "ar" ? -1 : 1);
  });

  it(`CART-01 · line: thumbnail, 2-line title, stepper, price (${locale})`, () => {
    login();
    useCartStore.setState({ cart: cartOf() });
    wrap(locale, <CartContents variant="page" />);
    expect(screen.getByTestId("line-thumb").className).toContain("aspect-[4/5]");
    expect(screen.getByTestId("image-placeholder")).toBeTruthy(); // product has no image
    expect(screen.getByRole("link", { name: titleOf(sofa) }).className).toContain("line-clamp-2");
    expect(screen.getByTestId("line-qty").textContent).toBe("2");
    expect(screen.getByTestId("line-total")).toBeTruthy();
  });

  it(`UI-01 · cart v2: square thumbnails, a flat summary with no card, a square-cornered stepper, a full-height checkout button (${locale})`, () => {
    login();
    const withImage = { ...sofa, images: [{ url: "https://cdn.test/1.jpg", alt: { en: "x", ar: "س" } }] } as HomeProduct;
    useCartStore.setState({ cart: cartOf({}, withImage) });
    wrap(locale, <CartContents variant="page" />);
    expect(screen.getByTestId("line-thumb").className).toContain("rounded-lg"); // ADR-018: 8 px corners
    expect(screen.getByTestId("line-thumb").querySelector("img")!.className).toContain("mix-blend-multiply");
    expect(screen.getByRole("group", { name: m.product.quantity }).className).toContain("rounded-sm");
    const summary = screen.getByTestId("cart-summary");
    expect(summary.className).not.toMatch(/shadow|rounded|bg-card/);
    expect(summary.className).not.toMatch(/border(?!-t)/); // a hairline above it, no box
    const checkout = screen.getByTestId("cart-checkout");
    expect(checkout.className).toContain("h-12");
    expect(checkout.className).toContain("bg-primary");
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("text-3xl");
  });

  it(`QA-10 · every line shows its unit price, whatever the quantity, so a pre-owned line is not the odd one out (${locale})`, () => {
    // QA 2026-11-24 item 10: the unit price used to appear only above quantity 1, and a pre-owned item is
    // always a single piece, so those lines showed no price under the name at all.
    login();
    useCartStore.setState({ cart: cartOf({ items: [{ productId: sofa.id, product: sofa, qty: 1, lineTotal: 129950, issue: null }], subtotal: 129950, total: 129950 }) });
    const { unmount } = wrap(locale, <CartContents variant="page" />);
    expect(screen.getByTestId("line-unit-price").textContent).toContain("1,299.50");
    expect(screen.getByTestId("line-total")).toBeTruthy();
    unmount();
    // a pre-owned line (stock 1, quantity 1) shows it too
    const resale = { ...sofa, type: "RESALE", condition: "GOOD", stock: 1 } as HomeProduct;
    useCartStore.setState({ cart: cartOf({ items: [{ productId: resale.id, product: resale, qty: 1, lineTotal: 129950, issue: null }], subtotal: 129950, total: 129950 }) });
    const second = wrap(locale, <CartContents variant="page" />);
    expect(screen.getByTestId("line-unit-price").textContent).toContain("1,299.50");
    second.unmount();
    // and so does a line with more than one
    useCartStore.setState({ cart: cartOf() });
    wrap(locale, <CartContents variant="page" />);
    expect(screen.getByTestId("line-unit-price")).toBeTruthy();
  });

  it(`CART-01 · a product image replaces the placeholder (${locale})`, () => {
    login();
    const withImage = { ...sofa, images: [{ url: "https://cdn.test/1.jpg", alt: { en: "x", ar: "س" } }] } as HomeProduct;
    useCartStore.setState({ cart: cartOf({}, withImage) });
    wrap(locale, <CartContents variant="page" />);
    expect(screen.queryByTestId("image-placeholder")).toBeNull();
    expect(screen.getByTestId("line-thumb").querySelector("img")).not.toBeNull();
  });

  it(`CART-01 · remove shows an undo toast and Undo puts the same quantity back (${locale})`, async () => {
    login();
    useCartStore.setState({ cart: cartOf() });
    mockApi((c) =>
      c.method === "PUT" && (c.body as { qty: number }).qty === 0
        ? { body: cartOf({ items: [], subtotal: 0, total: 0 }) }
        : { body: cartOf() },
    );
    wrap(locale, <CartContents variant="page" />);
    fireEvent.click(screen.getByRole("button", { name: m.cart.remove.replace("{title}", titleOf(sofa)) }));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/cart/items", body: { productId: ID1, qty: 0 } });
    const [message, opts] = toast.mock.calls[0]!;
    expect(message).toBe(m.cart.removed.replace("{title}", titleOf(sofa)));
    expect(opts.action.label).toBe(m.cart.undo);
    await act(async () => {
      opts.action.onClick();
    });
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ method: "PUT", body: { productId: ID1, qty: 2 } }));
  });

  it(`CART-01 · a failed removal shows no undo toast (${locale})`, async () => {
    login();
    useCartStore.setState({ cart: cartOf() });
    mockApi(() => ({ status: 500, body: { code: "INTERNAL_ERROR", message: "x" } }));
    wrap(locale, <CartContents variant="page" />);
    fireEvent.click(screen.getByRole("button", { name: m.cart.remove.replace("{title}", titleOf(sofa)) }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(toast).not.toHaveBeenCalled();
  });

  it(`CART-01 · the free-delivery bar uses the strong gold on an outlined track and shows progress (${locale})`, () => {
    login();
    useCartStore.setState({ cart: cartOf(), config: { freeDeliveryThreshold: 519800, hasCityFeeOverride: false } });
    wrap(locale, <CartContents variant="page" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(bar.className).toContain("border-input");
    expect(bar.firstElementChild!.className).toContain("bg-gold-strong");
  });

  it(`CART-01 · VAT line only when vatRate > 0, delivery free label, total (${locale})`, () => {
    login();
    useCartStore.setState({ cart: cartOf() });
    wrap(locale, <CartContents variant="page" />);
    expect(screen.queryByTestId("cart-vat")).toBeNull();
    expect(screen.getByTestId("cart-delivery").textContent).toBe(m.cart.freeDelivery);
    cleanup();
    useCartStore.setState({ cart: cartOf({ vat: { ...vat0, vatRate: 15, vatAmount: 33900 }, total: 259900 }) });
    wrap(locale, <CartContents variant="page" />);
    expect(screen.getByTestId("cart-vat")).toBeTruthy();
  });

  it(`CART-01 · the checkout button is a sticky bar on mobile on the page, not in the drawer (${locale})`, () => {
    login();
    useCartStore.setState({ cart: cartOf() });
    const { unmount } = wrap(locale, <CartContents variant="page" />);
    const bar = screen.getByTestId("cart-checkout-bar");
    expect(bar.className).toContain("max-md:sticky");
    expect(bar.className).toContain("max-md:bottom-0");
    expect(bar.contains(screen.getByTestId("cart-checkout"))).toBe(true);
    unmount();
    wrap(locale, <CartContents variant="drawer" />);
    expect(screen.getByTestId("cart-checkout-bar").className).not.toContain("sticky");
  });
});
