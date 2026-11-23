// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
const messages = { en, ar } as const;
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale }: { locale: "en" | "ar" }) =>
    createTranslator({ locale, messages: messages[locale] }),
}));

import { Gallery } from "@/components/product/gallery";
import { ProductDetailView } from "@/components/product/product-detail";
import { PurchaseBox } from "@/components/product/purchase-box";
import type { HomeProduct, ProductDetail } from "@/lib/api/public";

type L = "en" | "ar";
const wrap = (locale: L, ui: React.ReactNode) => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
};

const imgs = [1, 2, 3].map((n) => ({ url: `https://cdn.example.com/${n}.webp`, alt: { en: `Photo ${n}`, ar: `صورة ${n}` } }));
const base: ProductDetail = {
  id: "1", slug: "oak-sofa", title: { en: "Oak sofa", ar: "أريكة بلوط" },
  description: { en: "Solid oak.", ar: "بلوط صلب." },
  type: "NEW", condition: "NEW", price: 129950, compareAtPrice: 159900, stock: 5, images: imgs,
  sku: "SOF-1", material: "Oak", color: "Walnut", category: { id: "c", slug: "sofas", name: { en: "Sofas", ar: "أرائك" }, parentId: null, sortOrder: 0, isActive: true },
  dimensions: { widthCm: 200, depthCm: 90, heightCm: 85, weightKg: 40 },
};
const rel: HomeProduct = { id: "2", slug: "chair", title: { en: "Chair", ar: "كرسي" }, type: "NEW", condition: "NEW", price: 10000, stock: 1, images: [] };

async function view(locale: L, p: Partial<ProductDetail> = {}, vat?: { vatRate: number; pricesIncludeVat: boolean }) {
  const ui = await ProductDetailView({
    product: { ...base, ...p }, related: [rel], settings: vat ? { vat } : null, locale,
  });
  return wrap(locale, ui);
}

afterEach(cleanup);

for (const locale of ["en", "ar"] as const) {
  describe(`PROD-02 · product detail (${locale})`, () => {
    it(`PROD-02 · shows title, formatted price, compare-at, specs and related (${locale})`, async () => {
      await view(locale);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(locale === "en" ? "Oak sofa" : "أريكة بلوط");
      expect(screen.getByTestId("price").textContent).toMatch(locale === "en" ? /1,299\.50/ : /1,299\.50/);
      expect(screen.getByTestId("compare-price")).toBeTruthy();
      const specs = within(screen.getByTestId("specs"));
      expect(specs.getByText("Oak")).toBeTruthy();
      expect(specs.getByText(locale === "en" ? /200 × 90 × 85 cm/ : /200 × 90 × 85 سم/)).toBeTruthy();
      expect(within(screen.getByTestId("related")).getByText(locale === "en" ? "Chair" : "كرسي")).toBeTruthy();
      expect(screen.getByText(messages[locale].product.delivery.body)).toBeTruthy();
    });

    it(`PROD-02 · sold out disables Add to cart and shows "Sold out" (${locale})`, async () => {
      await view(locale, { stock: 0 });
      const btn = screen.getByRole("button", { name: messages[locale].badge.soldOut });
      expect((btn as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId("stock-text").textContent).toBe(messages[locale].badge.soldOut);
    });

    it(`PROD-02 · VAT note follows settings and is hidden at rate 0 (${locale})`, async () => {
      const { unmount } = await view(locale, {}, { vatRate: 15, pricesIncludeVat: true });
      expect(screen.getByTestId("vat-note").textContent).toBe(messages[locale].product.vatIncl);
      unmount();
      const second = await view(locale, {}, { vatRate: 15, pricesIncludeVat: false });
      expect(screen.getByTestId("vat-note").textContent).toBe(messages[locale].product.vatExcl);
      second.unmount();
      await view(locale, {}, { vatRate: 0, pricesIncludeVat: true });
      expect(screen.queryByTestId("vat-note")).toBeNull();
    });

    it(`PROD-02 · resale shows condition panel, notes and "only N left" (${locale})`, async () => {
      await view(locale, {
        type: "RESALE", condition: "GOOD", stock: 1,
        conditionNotes: { en: "Small scratch", ar: "خدش صغير" },
      });
      expect(screen.getByTestId("condition-notes").textContent).toBe(locale === "en" ? "Small scratch" : "خدش صغير");
      expect(screen.getByTestId("stock-text").textContent).toBe(locale === "en" ? "Only 1 left" : "بقيت قطعة واحدة فقط");
    });

    it(`PROD-02 · new product has no condition panel; description stays plain text (${locale})`, async () => {
      await view(locale, { description: { en: "<b>x</b>", ar: "<b>x</b>" } });
      expect(screen.queryByTestId("condition-grade")).toBeNull();
      expect(screen.getByTestId("description").textContent).toBe("<b>x</b>");
      expect(document.querySelector("[data-testid=description] b")).toBeNull();
    });

    it(`PROD-02 · gallery is keyboard/button operable with labelled thumbnails (${locale})`, () => {
      const m = messages[locale].product.gallery;
      wrap(locale, <Gallery images={imgs} title="T" locale={locale} />);
      const main = screen.getByTestId("gallery-main");
      expect(within(main).getByRole("img").getAttribute("alt")).toBe(locale === "en" ? "Photo 1" : "صورة 1");
      const thumbs = screen.getAllByRole("button", { name: /1|2|3|١|٢|٣/ }).filter((b) => b.hasAttribute("aria-current") || b.getAttribute("aria-label")?.includes("3"));
      expect(thumbs.length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: m.next }));
      expect(within(main).getByRole("img").getAttribute("alt")).toBe(locale === "en" ? "Photo 2" : "صورة 2");
      fireEvent.click(screen.getByRole("button", { name: m.prev }));
      fireEvent.click(screen.getByRole("button", { name: m.prev }));
      expect(within(main).getByRole("img").getAttribute("alt")).toBe(locale === "en" ? "Photo 3" : "صورة 3");
      // swipe: toward the start edge goes forward (RTL flips)
      const startX = locale === "en" ? 200 : 100;
      const endX = locale === "en" ? 100 : 200;
      fireEvent.touchStart(main, { touches: [{ clientX: startX }] });
      fireEvent.touchEnd(main, { changedTouches: [{ clientX: endX }] });
      expect(within(main).getByRole("img").getAttribute("alt")).toBe(locale === "en" ? "Photo 1" : "صورة 1");
      const zoom = screen.getByRole("button", { name: m.zoomIn });
      fireEvent.click(zoom);
      expect(screen.getByRole("button", { name: m.zoomOut }).getAttribute("aria-pressed")).toBe("true");
    });

    it(`PROD-02 · gallery without images shows a placeholder (${locale})`, () => {
      wrap(locale, <Gallery images={[]} title="T" locale={locale} />);
      expect(screen.getByTestId("gallery-empty").textContent).toBe(messages[locale].product.gallery.noImage);
    });

    it(`PROD-02 · quantity is capped at stock; add-to-cart stays a disabled hook until T-036 (${locale})`, () => {
      wrap(locale, <PurchaseBox stock={2} locale={locale} />);
      const plus = screen.getByRole("button", { name: messages[locale].product.increase }) as HTMLButtonElement;
      fireEvent.click(plus);
      expect(plus.disabled).toBe(true);
      expect(screen.getByTestId("qty").textContent).toBe("2");
      expect((screen.getByRole("button", { name: messages[locale].cart.addToCart }) as HTMLButtonElement).disabled).toBe(true);
    });

    it(`PROD-02 · add-to-cart calls the T-036 hook with the quantity when provided (${locale})`, () => {
      const onAdd = vi.fn();
      wrap(locale, <PurchaseBox stock={3} locale={locale} onAdd={onAdd} />);
      fireEvent.click(screen.getByRole("button", { name: messages[locale].product.increase }));
      fireEvent.click(screen.getByRole("button", { name: messages[locale].cart.addToCart }));
      expect(onAdd).toHaveBeenCalledWith(2);
    });
  });
}
