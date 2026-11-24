// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/shop",
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import { ShopFrame } from "@/components/shop/shop-controls";
import { ActiveChips, Pagination, ProductGrid } from "@/components/shop/shop-results";
import type { Category, HomeProduct } from "@/lib/api/public";
import { pageWindow, parseFilters, shopHref, toApiQuery } from "@/lib/shop";

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

const cats: Category[] = [
  {
    id: "1", slug: "sofas", name: { en: "Sofas", ar: "أرائك" }, parentId: null, sortOrder: 0, isActive: true,
    children: [{ id: "2", slug: "corner-sofas", name: { en: "Corner sofas", ar: "أرائك ركنية" }, parentId: "1", sortOrder: 0, isActive: true }],
  },
];
const prod = (id: string, type: "NEW" | "RESALE", stock = 2): HomeProduct => ({
  id, slug: `p-${id}`, title: { en: `Chair ${id}`, ar: `كرسي ${id}` }, type,
  condition: type === "NEW" ? "NEW" : "GOOD", price: 49900, compareAtPrice: null, stock, images: [],
});

afterEach(() => { cleanup(); push.mockClear(); });

describe("PROD-01 · filters <-> URL <-> API query", () => {
  it("PROD-01 · parses home links (type=new|resale, category, q)", () => {
    expect(parseFilters({ type: "resale" }).type).toBe("RESALE");
    expect(parseFilters({ type: "new" }).type).toBe("NEW");
    expect(parseFilters({ category: "sofas", q: " oak " })).toMatchObject({ category: "sofas", q: "oak" });
  });
  it("PROD-01 · drops invalid values and defaults to newest, page 1", () => {
    const f = parseFilters({ type: "x", sort: "bogus", page: "-2", minPrice: "abc", condition: "good,zzz,good" });
    expect(f).toMatchObject({ type: undefined, sort: "newest", page: 1, minPrice: undefined, condition: ["GOOD"] });
  });
  it("PROD-01 · API query: halalas, comma conditions, 24 per page", () => {
    const f = parseFilters({ type: "resale", condition: "good,fair", minPrice: "10000", maxPrice: "50000", material: "oak", inStock: "true", sort: "price_asc", page: "3" });
    const q = new URLSearchParams(toApiQuery(f));
    expect(Object.fromEntries(q)).toEqual({
      type: "RESALE", condition: "GOOD,FAIR", minPrice: "10000", maxPrice: "50000", material: "oak",
      inStock: "true", sort: "price_asc", page: "3", limit: "24",
    });
  });
  it("PROD-01 · URL round-trips every filter and omits defaults", () => {
    const f = parseFilters({ category: "sofas", type: "new", condition: "like_new", sort: "featured", page: "2", inStock: "true" });
    expect(parseFilters(Object.fromEntries(new URLSearchParams(shopHref(f).split("?")[1])))).toEqual(f);
    expect(shopHref(parseFilters({}))).toBe("/shop");
  });
  it("PROD-01 · page window keeps first, last and neighbours", () => {
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });
});

describe.each(["en", "ar"] as const)("PROD-01 · shop UI (%s)", (locale) => {
  it("PROD-01 · a pre-owned card shows its grade, a new card no badge, and the title links to the detail", () => {
    wrap(locale, <ProductGrid items={[prod("a", "NEW"), prod("b", "RESALE")]} locale={locale} filters={parseFilters({})} />);
    const m = messages[locale];
    expect(screen.queryByText(m.badge.new)).toBeNull(); // no "New" badge on new products
    expect(screen.getByText(m.badge.preowned.replace("{grade}", m.condition.GOOD))).toBeTruthy();
    expect((screen.getAllByRole("link")[0]).getAttribute("href")).toBe("/shop/p-a");
  });

  it("PROD-01 · sold-out product shows the sold out badge (stock as returned)", () => {
    wrap(locale, <ProductGrid items={[prod("a", "NEW", 0)]} locale={locale} filters={parseFilters({})} />);
    expect(screen.getAllByText(messages[locale].badge.soldOut).length).toBeGreaterThan(0); // the badge (and the disabled add button)
  });

  it("PROD-01 · empty state with Clear filters when filters are active", () => {
    wrap(locale, <ProductGrid items={[]} locale={locale} filters={parseFilters({ type: "new" })} />);
    const box = screen.getByTestId("shop-empty");
    expect(within(box).getByText(messages[locale].shop.empty.title)).toBeTruthy();
    expect((within(box).getByRole("link", { name: messages[locale].shop.clearFilters })).getAttribute("href")).toBe("/shop");
  });

  it("PROD-01 · removable chips each drop only their own filter and reset the page", () => {
    const filters = parseFilters({ category: "corner-sofas", type: "resale", condition: "good,fair", maxPrice: "90000", page: "4" });
    wrap(locale, <ActiveChips filters={filters} categories={cats} locale={locale} />);
    const cat = document.querySelector('[data-chip="category"]') as HTMLAnchorElement;
    expect(cat.textContent).toContain(locale === "ar" ? "أرائك ركنية" : "Corner sofas");
    expect(cat.getAttribute("href")).toBe("/shop?type=resale&condition=GOOD%2CFAIR&maxPrice=90000");
    const good = document.querySelector('[data-chip="c-GOOD"]') as HTMLAnchorElement;
    expect(good.getAttribute("href")).toContain("condition=FAIR");
    expect(good.getAttribute("href")).not.toContain("page=");
  });

  it("PROD-01 · numbered pagination links keep the filters", () => {
    const filters = parseFilters({ type: "new", page: "2" });
    wrap(locale, <Pagination filters={filters} meta={{ page: 2, limit: 24, total: 80, totalPages: 4 }} />);
    const nav = screen.getByRole("navigation", { name: messages[locale].shop.pagination });
    expect((within(nav).getByText("2")).getAttribute("aria-current")).toBe("page");
    expect((within(nav).getByRole("link", { name: messages[locale].shop.nextPage })).getAttribute("href")).toBe("/shop?type=new&page=3");
    expect((within(nav).getByRole("link", { name: messages[locale].shop.prevPage })).getAttribute("href")).toBe("/shop?type=new");
  });

  it("PROD-01 · filter form pushes all filters to the URL (price in SAR -> halalas)", () => {
    wrap(locale, <ShopFrame filters={parseFilters({})} categories={cats} locale={locale}><p>results</p></ShopFrame>);
    const m = messages[locale].shop;
    fireEvent.click(screen.getByLabelText(m.type.resale));
    fireEvent.click(screen.getByLabelText(messages[locale].condition.GOOD));
    fireEvent.click(screen.getByLabelText(m.inStock));
    fireEvent.change(screen.getByLabelText(m.minPrice), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(m.maxPrice), { target: { value: "2500.5" } });
    fireEvent.click(screen.getByRole("button", { name: m.apply }));
    expect(push).toHaveBeenCalledWith("/shop?type=resale&condition=GOOD&minPrice=10000&maxPrice=250050&inStock=true");
  });

  it("PROD-01 · mobile filter sheet opens from the button and closes with Escape", () => {
    wrap(locale, <ShopFrame filters={parseFilters({})} categories={cats} locale={locale}><p>r</p></ShopFrame>);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages[locale].shop.filters }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("PROD-01 · sort select resets to page 1 and keeps filters", () => {
    wrap(locale, <ShopFrame filters={parseFilters({ type: "new", page: "3" })} categories={[]} locale={locale}><p>r</p></ShopFrame>);
    fireEvent.change(screen.getByTestId("sort-toolbar"), { target: { value: "price_desc" } });
    expect(push).toHaveBeenCalledWith("/shop?type=new&sort=price_desc");
  });

  it("PROD-01 · on mobile the sort lives in the filter sheet and behaves the same", () => {
    wrap(locale, <ShopFrame filters={parseFilters({ type: "new", page: "3" })} categories={[]} locale={locale}><p>r</p></ShopFrame>);
    fireEvent.click(screen.getByRole("button", { name: messages[locale].shop.filters, expanded: false }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("bottom-0"); // a bottom sheet, not a full-screen page
    fireEvent.change(within(dialog).getByTestId("sort-sheet"), { target: { value: "price_asc" } });
    expect(push).toHaveBeenCalledWith("/shop?type=new&sort=price_asc");
    expect(screen.getByTestId("filters-backdrop")).toBeTruthy();
  });

  it("CAT-01 · category filter lists active categories with one level of children, localized", () => {
    wrap(locale, <ShopFrame filters={parseFilters({})} categories={cats} locale={locale}><p>r</p></ShopFrame>);
    expect(screen.getByLabelText(locale === "ar" ? "أرائك" : "Sofas")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(locale === "ar" ? "أرائك ركنية" : "Corner sofas"));
    fireEvent.click(screen.getByRole("button", { name: messages[locale].shop.apply }));
    expect(push).toHaveBeenCalledWith("/shop?category=corner-sofas");
  });
});
