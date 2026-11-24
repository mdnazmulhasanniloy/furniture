// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));
vi.mock("@/lib/cart/store", () => ({ addToCart: vi.fn(async () => true) }));

import { ProductCard } from "@/components/home/product-card";
import { Rail } from "@/components/rail";
import type { HomeProduct } from "@/lib/api/public";

const messages = { en, ar } as const;
type L = "en" | "ar";
const wrap = (locale: L, ui: React.ReactNode) => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // @ts-expect-error jsdom has no matchMedia; remove the stub
  delete window.matchMedia;
});

const product: HomeProduct = {
  id: "p1",
  slug: "p-1",
  title: { en: "Oak table", ar: "طاولة بلوط" },
  type: "NEW",
  condition: "NEW",
  price: 100000,
  stock: 3,
  images: [{ url: "https://cdn.test/a.jpg" }],
};

/** jsdom has no layout: give the rail a measurable scroll range. */
function layout(scrollWidth: number, clientWidth: number, scrollLeft: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth);
  Object.defineProperty(HTMLElement.prototype, "scrollLeft", { configurable: true, writable: true, value: scrollLeft });
}

describe.each(["en", "ar"] as const)("UI-04 · rails (%s)", (locale) => {
  const m = messages[locale];

  it(`UI-04 · a rail hides its native scrollbar, keeps snap and shows only the arrow that can scroll (${locale})`, () => {
    layout(1200, 400, 0);
    wrap(locale, <Rail label="Related" testId="rail"><li>a</li><li>b</li></Rail>);
    const list = screen.getByTestId("rail");
    expect(list.className).toContain("rail-scroll");
    expect(list.className).not.toMatch(/overflow-x-auto/);
    expect(screen.queryByRole("button", { name: m.home.carousel.previous })).toBeNull(); // at the start
    expect(screen.getByRole("button", { name: m.home.carousel.next })).toBeTruthy();
  });

  it(`UI-04 · no arrows when everything fits (${locale})`, () => {
    layout(300, 400, 0);
    wrap(locale, <Rail label="Related"><li>a</li></Rail>);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it(`UI-04 · the arrow buttons and the arrow keys scroll by most of the rail width, mirrored in RTL (${locale})`, () => {
    layout(1200, 400, 0);
    const scrollBy = vi.fn();
    HTMLElement.prototype.scrollBy = scrollBy as unknown as typeof HTMLElement.prototype.scrollBy;
    wrap(locale, <Rail label="Related" testId="rail"><li>a</li></Rail>);
    const sign = locale === "ar" ? -1 : 1; // toward the inline end
    fireEvent.click(screen.getByRole("button", { name: m.home.carousel.next }));
    expect(scrollBy.mock.calls[0]![0].left).toBeCloseTo(sign * 340);
    const forwardKey = locale === "ar" ? "ArrowLeft" : "ArrowRight";
    fireEvent.keyDown(screen.getByTestId("rail"), { key: forwardKey });
    expect(scrollBy.mock.calls[1]![0].left).toBeCloseTo(sign * 340);
    fireEvent.keyDown(screen.getByTestId("rail"), { key: forwardKey === "ArrowLeft" ? "ArrowRight" : "ArrowLeft" });
    expect(scrollBy.mock.calls[2]![0].left).toBeCloseTo(-sign * 340);
  });
});

describe.each(["en", "ar"] as const)("UI-04 · product cards (%s)", (locale) => {
  it(`UI-04 · the card photo has 8 px corners and zooms on hover and focus; the title uses the body face (${locale})`, () => {
    wrap(locale, <ul><ProductCard product={product} locale={locale} /></ul>);
    expect(screen.getByTestId("card-media").className).toContain("rounded-lg");
    expect(screen.getByRole("link", { name: /Oak table|طاولة بلوط/ }).className).toContain("zoom-on-hover");
    const title = screen.getByRole("heading", { level: 3 });
    expect(title.className).not.toContain("font-display");
    expect(title.className).toContain("text-base");
  });
});

describe("UI-04 · CSS: tile zoom is off under reduced motion; h3 and h4 use the body face (Q-10)", () => {
  const css = readFileSync(path.resolve(import.meta.dirname, "..", "app", "globals.css"), "utf8");
  it("UI-04 · the hover zoom is cancelled for reduced motion", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.zoom-on-hover:is\(:hover, :focus-visible\) img\s*\{\s*transform:\s*none/);
  });
  it("UI-04 · h3 and h4 do not use the display face", () => {
    expect(css).toMatch(/h3,\s*h4\s*\{\s*font-family:\s*var\(--font-body\)/);
  });
});
