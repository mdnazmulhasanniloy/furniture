// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/shop/x",
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => <img src={src} alt={alt} className={className} />,
}));
const messages = { en, ar } as const;
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale }: { locale: "en" | "ar" }) =>
    createTranslator({ locale, messages: messages[locale] }),
}));
const addToCart = vi.fn(async () => true);
vi.mock("@/lib/cart/store", () => ({ addToCart: (...a: unknown[]) => addToCart(...(a as [])) }));
const flyToCart = vi.fn();
vi.mock("@/lib/cart/fly", () => ({ flyToCart: (...a: unknown[]) => flyToCart(...a) }));

import { Gallery } from "@/components/product/gallery";
import { ProductDetailView } from "@/components/product/product-detail";
import type { ProductDetail } from "@/lib/api/public";

type L = "en" | "ar";
const wrap = (locale: L, ui: React.ReactNode) => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
};
const imgs = [1, 2, 3, 4].map((n) => ({ url: `https://cdn.example.com/${n}.webp`, alt: { en: `Photo ${n}`, ar: `صورة ${n}` } }));
const base: ProductDetail = {
  id: "1", slug: "oak-sofa", title: { en: "Oak sofa", ar: "أريكة بلوط" },
  description: { en: "Solid oak.", ar: "بلوط صلب." },
  type: "RESALE", condition: "GOOD", price: 129950, stock: 1, images: imgs,
  conditionNotes: { en: "A small scratch on the left arm.", ar: "خدش صغير على الذراع اليسرى." },
  category: { id: "c", slug: "sofas", name: { en: "Sofas", ar: "أرائك" }, parentId: null, sortOrder: 0, isActive: true },
};
async function view(locale: L, p: Partial<ProductDetail> = {}) {
  const ui = await ProductDetailView({ product: { ...base, ...p }, related: [], settings: null, locale });
  return wrap(locale, ui);
}

let observe: (entries: { isIntersecting: boolean }[]) => void = () => {};
beforeEach(() => {
  addToCart.mockClear();
  flyToCart.mockClear();
  class IO {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
      observe = cb;
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", IO);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(["en", "ar"] as const)("PROD-02 · product page v2 (%s)", (locale) => {
  const m = messages[locale];
  const L = (en_: string, ar_: string) => (locale === "en" ? en_ : ar_);

  it(`PROD-02 · breadcrumb: home, category link, current product (${locale})`, async () => {
    await view(locale);
    const nav = screen.getByRole("navigation", { name: m.product.breadcrumb.label });
    expect(within(nav).getByRole("link", { name: m.product.breadcrumb.home }).getAttribute("href")).toBe("/");
    expect(within(nav).getByRole("link", { name: L("Sofas", "أرائك") }).getAttribute("href")).toBe("/shop?category=sofas");
    expect(nav.querySelector('[aria-current="page"]')!.textContent).toContain(L("Oak sofa", "أريكة بلوط"));
  });

  it(`UI-01 · the buy box is sticky on desktop; the title is the page h1 (${locale})`, async () => {
    await view(locale);
    const box = screen.getByTestId("buy-box");
    expect(box.className).toContain("lg:sticky");
    expect(within(box).getByRole("heading", { level: 1 }).textContent).toBe(L("Oak sofa", "أريكة بلوط"));
    expect(within(box).getByTestId("add-to-cart")).toBeTruthy();
  });

  it(`UI-01 · gallery: 4:5 square-cornered image on sand, thumbnails under it, no shadows (${locale})`, () => {
    wrap(locale, <Gallery images={imgs} title="T" locale={locale} />);
    const main = screen.getByTestId("gallery-main");
    expect(main.className).toContain("aspect-[4/5]");
    expect(main.className).toContain("bg-muted");
    expect(main.className).not.toMatch(/rounded/);
    expect(main.querySelector("img")!.className).toContain("mix-blend-multiply");
    const section = main.closest("section")!;
    expect(section.className).not.toContain("flex-row");
    expect(section.innerHTML).not.toMatch(/\bshadow/);
  });

  it(`PROD-02 · condition report: title, four-step grade scale with the current grade marked (${locale})`, async () => {
    await view(locale);
    const report = screen.getByTestId("condition-report");
    expect(within(report).getByRole("heading", { level: 2 }).textContent).toBe(m.product.condition.title);
    const steps = within(screen.getByTestId("grade-scale")).getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("data-grade"))).toEqual(["NEW", "LIKE_NEW", "GOOD", "FAIR"]);
    expect(steps.map((s) => s.textContent)).toEqual([m.condition.NEW, m.condition.LIKE_NEW, m.condition.GOOD, m.condition.FAIR]);
    const current = steps.filter((s) => s.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("data-grade")).toBe("GOOD");
    expect(current[0].className).toContain("bg-foreground");
    expect(screen.getByTestId("condition-grade").textContent).toContain(m.product.condition.grades.GOOD);
  });

  it(`PROD-02 · condition report: the seller's notes, close-ups from the extra photos, and the byline (${locale})`, async () => {
    await view(locale);
    expect(screen.getByTestId("condition-notes").textContent).toBe(L("A small scratch on the left arm.", "خدش صغير على الذراع اليسرى."));
    const closeups = within(screen.getByTestId("closeups")).getAllByRole("img");
    expect(closeups.map((i) => i.getAttribute("src"))).toEqual(imgs.slice(1).map((i) => i.url)); // not the first photo
    expect(screen.getByTestId("condition-byline").textContent).toBe(L("Photos and condition notes by Furnixa", "الصور وملاحظات الحالة من فرنيكس"));
  });

  it(`PROD-02 · condition report omits notes and close-ups when there is no data, never inventing them (${locale})`, async () => {
    await view(locale, { conditionNotes: null, images: [imgs[0]] });
    expect(screen.queryByTestId("condition-notes")).toBeNull();
    expect(screen.queryByTestId("closeups")).toBeNull();
    expect(screen.getByTestId("condition-byline")).toBeTruthy();
  });

  it(`PROD-02 · the report never claims inspection, in any grade wording or the byline (${locale})`, async () => {
    const all = [m.product.condition.byline, ...Object.values(m.product.condition.grades)].join(" ");
    expect(all).not.toMatch(/inspect|فحص|مفحوص/i);
    for (const condition of ["NEW", "LIKE_NEW", "GOOD", "FAIR"] as const) {
      const { unmount } = await view(locale, { condition });
      expect(screen.getByTestId("condition-report").textContent).not.toMatch(/inspect|فحص|مفحوص/i);
      unmount();
    }
  });

  it(`PROD-02 · a new product has no condition report (${locale})`, async () => {
    await view(locale, { type: "NEW", condition: "NEW" });
    expect(screen.queryByTestId("condition-report")).toBeNull();
  });

  it(`PROD-02 · the mobile buy bar shows only while the inline button is out of view (${locale})`, async () => {
    await view(locale);
    expect(screen.queryByTestId("sticky-buy-bar")).toBeNull();
    act(() => observe([{ isIntersecting: false }]));
    const bar = screen.getByTestId("sticky-buy-bar");
    expect(bar.className).toContain("fixed");
    expect(bar.className).toContain("bottom-0");
    expect(bar.className).toContain("lg:hidden");
    expect(bar.querySelector("bdi")).not.toBeNull(); // the price
    fireEvent.click(within(bar).getByTestId("sticky-add"));
    await waitFor(() => expect(addToCart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(flyToCart).toHaveBeenCalledTimes(1));
    act(() => observe([{ isIntersecting: true }]));
    expect(screen.queryByTestId("sticky-buy-bar")).toBeNull();
  });

  it(`PROD-02 · no mobile buy bar for a sold-out item (${locale})`, async () => {
    await view(locale, { stock: 0 });
    act(() => observe([{ isIntersecting: false }]));
    expect(screen.queryByTestId("sticky-buy-bar")).toBeNull();
  });
});
