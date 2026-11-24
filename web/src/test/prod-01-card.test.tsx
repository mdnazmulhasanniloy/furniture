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
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => <img src={src} alt={alt} className={className} />,
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

  it(`PROD-01 · a missing image shows the flat sand placeholder with the wordmark (${locale})`, () => {
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

  it(`UI-01 · the tile has no border and no shadow; only the photo has the 8 px corner (ADR-018, was square) (${locale})`, () => {
    wrap(locale, <ProductCard product={base} locale={locale} favourite={{ active: false, toggle: vi.fn() }} />);
    const tile = screen.getByTestId("product-card");
    expect(tile.className).not.toMatch(/(?:border|shadow|rounded)/);
    const media = screen.getByTestId("card-media");
    expect(media.className).toContain("bg-muted");
    expect(media.className).toContain("rounded-lg"); // ADR-018: image corners 4 to 8 px (the arch and square corners are gone)
    expect(media.querySelector("img")!.className).toContain("mix-blend-multiply");
  });

  it(`UI-01 · the condition chip sits under the image beside the price, never on the photo (${locale})`, () => {
    wrap(locale, <ProductCard product={{ ...base, type: "RESALE", condition: "LIKE_NEW", isFeatured: true }} locale={locale} />);
    const chips = screen.getByTestId("card-chips");
    expect(screen.getByTestId("card-media").contains(chips)).toBe(false);
    expect(chips.textContent).toContain(m.condition.LIKE_NEW);
    expect(chips.textContent).toContain(m.badge.featured);
    expect(chips.parentElement!.querySelector("bdi")).not.toBeNull(); // same row as the price
  });

  it(`UI-01 · chips use the sm radius, pre-owned is sand with ink, new is emerald with white (${locale})`, () => {
    const { unmount } = wrap(locale, <ProductCard product={base} locale={locale} />);
    const tag = (el: HTMLElement) => el.querySelector('[data-slot="badge"]')!.className;
    expect(tag(screen.getByTestId("card-chips"))).toMatch(/bg-primary.*text-primary-foreground|text-primary-foreground.*bg-primary/);
    expect(tag(screen.getByTestId("card-chips"))).toContain("rounded-sm");
    unmount();
    wrap(locale, <ProductCard product={{ ...base, type: "RESALE", condition: "GOOD" }} locale={locale} />);
    expect(tag(screen.getByTestId("card-chips"))).toContain("bg-secondary");
    expect(tag(screen.getByTestId("card-chips"))).toContain("text-secondary-foreground");
  });

  it(`UI-01 · quick add is visible on mobile and revealed on hover or focus only on hovering desktops (${locale})`, () => {
    wrap(locale, <ProductCard product={base} locale={locale} />);
    const cls = screen.getByTestId("quick-add").className;
    expect(cls).toContain("w-full");
    expect(cls).toContain("border-primary"); // outlined secondary button, not a filled slab on every tile
    expect(cls).toContain("lg:[@media(hover:hover)]:opacity-0");
    expect(cls).toContain("lg:[@media(hover:hover)]:group-hover:opacity-100");
    expect(cls).toContain("lg:[@media(hover:hover)]:focus-visible:opacity-100");
    expect(cls.split(" ")).not.toContain("opacity-0"); // never hidden below lg or on touch
  });

  it(`UI-01 · the heart sits in the top-end corner as a plain paper circle (${locale})`, () => {
    wrap(locale, <ProductCard product={base} locale={locale} favourite={{ active: false, toggle: vi.fn() }} />);
    const heart = screen.getByTestId("favourite-toggle");
    expect(heart.className).toContain("end-2");
    expect(heart.className).toContain("top-2");
    expect(heart.className).toContain("size-9");
    expect(heart.className).toContain("bg-card");
    expect(heart.className).not.toMatch(/border|shadow/);
  });

  it(`UI-01 · the second image is a desktop-only hover layer (${locale})`, () => {
    wrap(locale, <ProductCard product={base} locale={locale} />);
    const cls = screen.getByTestId("card-second-image").className.split(" ");
    expect(cls).toContain("hidden");
    expect(cls).toContain("lg:block");
  });

  it(`PROD-01 · the card has no physical left/right utilities (RTL-safe) (${locale})`, () => {
    wrap(locale, <ProductCard product={base} locale={locale} favourite={{ active: false, toggle: vi.fn() }} />);
    expect(document.body.innerHTML).not.toMatch(/\b(?:left|right|ml|mr|pl|pr)-\d/);
  });
});
