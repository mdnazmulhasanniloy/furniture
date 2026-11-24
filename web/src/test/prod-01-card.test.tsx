// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const addToCart = vi.fn(async () => true);
vi.mock("@/lib/cart/store", () => ({ addToCart: (...a: unknown[]) => addToCart(...(a as [])) }));
const flyToCart = vi.fn();
vi.mock("@/lib/cart/fly", () => ({ flyToCart: (...a: unknown[]) => flyToCart(...a) }));

import { ProductCard } from "@/components/home/product-card";
import type { HomeProduct } from "@/lib/api/public";

const messages = { en, ar } as const;
type L = "en" | "ar";
const img = (n: number) => ({ url: `https://cdn.test/${n}.jpg`, alt: { en: `Alt ${n}`, ar: `بديل ${n}` } });
const base: HomeProduct = {
  id: "p1",
  slug: "oak-chair",
  title: { en: "Oak dining chair with a very long name that must wrap onto two lines only", ar: "كرسي طعام من البلوط باسم طويل جدا يجب أن يلتف على سطرين فقط" },
  type: "NEW",
  condition: "NEW",
  price: 49900,
  compareAtPrice: 59900,
  stock: 3,
  images: [img(1), img(2)] as HomeProduct["images"],
};
const wrap = (locale: L, ui: React.ReactNode) => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <ul>{ui}</ul>
    </NextIntlClientProvider>,
  );
};

beforeEach(() => {
  addToCart.mockClear();
  flyToCart.mockClear();
});
afterEach(cleanup);

describe.each(["en", "ar"] as const)("PROD-01 · product card (%s)", (locale) => {
  const m = messages[locale];

  it(`PROD-01 · 4:5 image, 2-line title, price in the price colour, struck compare-at (${locale})`, () => {
    wrap(locale, <ProductCard product={base} locale={locale} />);
    expect(screen.getByTestId("card-media").className).toContain("aspect-[4/5]");
    expect(screen.getByRole("heading", { level: 3 }).className).toContain("line-clamp-2");
    const prices = document.querySelectorAll("bdi");
    expect(prices[0]!.className).toContain("text-price");
    expect(document.querySelector("s bdi")).not.toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/shop/oak-chair");
  });

  it(`PROD-01 · the second image sits above the first and fades in on hover and focus (${locale})`, () => {
    wrap(locale, <ProductCard product={base} locale={locale} />);
    const second = screen.getByTestId("card-second-image");
    expect(second.style.opacity).toBe("0");
    fireEvent.focus(screen.getByRole("link"));
    return waitFor(() => expect(Number(screen.getByTestId("card-second-image").style.opacity)).toBeGreaterThan(0));
  });

  it(`PROD-01 · a product with one image has no crossfade layer (${locale})`, () => {
    wrap(locale, <ProductCard product={{ ...base, images: [img(1)] as HomeProduct["images"] }} locale={locale} />);
    expect(screen.queryByTestId("card-second-image")).toBeNull();
  });

  it(`PROD-01 · new products show the New badge, resale the Pre-owned grade, featured the Featured badge (${locale})`, () => {
    const { unmount } = wrap(locale, <ProductCard product={{ ...base, isFeatured: true }} locale={locale} />);
    expect(screen.getByText(m.badge.new)).toBeTruthy();
    expect(screen.getByText(m.badge.featured)).toBeTruthy();
    unmount();
    wrap(locale, <ProductCard product={{ ...base, type: "RESALE", condition: "GOOD" }} locale={locale} />);
    expect(screen.getByText(m.badge.preowned.replace("{grade}", m.condition.GOOD))).toBeTruthy();
  });

  it(`PROD-01 · a missing image shows the emerald placeholder with the wordmark (${locale})`, () => {
    wrap(locale, <ProductCard product={{ ...base, images: [] }} locale={locale} />);
    expect(screen.getByTestId("image-placeholder").getAttribute("aria-label")).toBe(m.home.brand);
  });

  it(`PROD-01 · quick add adds one item and plays the fly animation (${locale})`, async () => {
    wrap(locale, <ProductCard product={base} locale={locale} />);
    fireEvent.click(screen.getByTestId("quick-add"));
    await waitFor(() => expect(addToCart).toHaveBeenCalledWith(base, 1));
    await waitFor(() => expect(flyToCart).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("quick-add").textContent).toBe(m.cart.addToCart);
  });

  it(`PROD-01 · stock 0 disables quick add and labels it Sold out (${locale})`, () => {
    wrap(locale, <ProductCard product={{ ...base, stock: 0 }} locale={locale} />);
    const btn = screen.getByTestId("quick-add") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe(m.badge.soldOut);
    fireEvent.click(btn);
    expect(addToCart).not.toHaveBeenCalled();
  });

  it(`PROD-01 · the heart appears only when favourites are wired, toggles and is pressed state (${locale})`, () => {
    const toggle = vi.fn();
    const { unmount } = wrap(locale, <ProductCard product={base} locale={locale} />);
    expect(screen.queryByTestId("favourite-toggle")).toBeNull();
    unmount();
    wrap(locale, <ProductCard product={base} locale={locale} favourite={{ active: true, toggle }} />);
    const heart = screen.getByTestId("favourite-toggle");
    expect(heart.getAttribute("aria-pressed")).toBe("true");
    expect(heart.getAttribute("aria-label")).toBe(m.favourites.remove);
    fireEvent.click(heart);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it(`PROD-01 · the card has no physical left/right utilities (RTL-safe) (${locale})`, () => {
    wrap(locale, <ProductCard product={base} locale={locale} favourite={{ active: false, toggle: vi.fn() }} />);
    expect(document.body.innerHTML).not.toMatch(/\b(?:left|right|ml|mr|pl|pr)-\d/);
  });
});
