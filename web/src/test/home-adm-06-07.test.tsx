// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
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
  getImageProps: (p: { src: string; alt: string }) => ({ props: { src: p.src, alt: p.alt, srcSet: `${p.src} 1x` } }),
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import { Hero } from "@/components/home/hero";
import { HomeSections } from "@/components/home/home-sections";
import type { Banner, HomeSection } from "@/lib/api/public";
import { safeHref, sectionHasContent } from "@/lib/home";

const messages = { en, ar } as const;
type L = "en" | "ar";

const img = { url: "https://cdn.example.com/a.webp" };
const banner = (id: string, en_: string, ar_: string, extra: Partial<Banner> = {}): Banner => ({
  id,
  title: { en: en_, ar: ar_ },
  subtitle: { en: `${en_} sub`, ar: `${ar_} فرعي` },
  ctaLabel: { en: "Browse", ar: "تصفح" },
  ctaHref: "/shop?type=new",
  imageDesktop: img,
  ...extra,
});
const product = (id: string, type: "NEW" | "RESALE" = "NEW") => ({
  id,
  slug: `p-${id}`,
  title: { en: `Sofa ${id}`, ar: `أريكة ${id}` },
  type,
  condition: type === "NEW" ? ("NEW" as const) : ("GOOD" as const),
  price: 129900,
  compareAtPrice: null,
  stock: 3,
  images: [img],
});
const sec = (
  id: string,
  type: HomeSection["type"],
  extra: Partial<HomeSection> = {},
): HomeSection => ({ id, type, title: { en: `T-${id}`, ar: `ع-${id}` }, ...extra });

function wrap(locale: L, ui: React.ReactNode) {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe.each(["en", "ar"] as const)("ADM-06 · hero banners (%s)", (locale) => {
  it("ADM-06 · renders the first active banner localized, with carousel controls", () => {
    wrap(locale, <Hero banners={[banner("1", "Winter", "الشتاء"), banner("2", "Spring", "الربيع")]} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      locale === "en" ? "Winter" : "الشتاء",
    );
    fireEvent.click(screen.getByRole("button", { name: messages[locale].home.carousel.goTo.replace("{n}", "2") }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      locale === "en" ? "Spring" : "الربيع",
    );
  });

  it("ADM-06 · hides the carousel controls for a single banner", () => {
    wrap(locale, <Hero banners={[banner("1", "Winter", "الشتاء")]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ADM-06 · unsafe CTA links are not rendered; the default Shop new action takes their place", () => {
    wrap(locale, <Hero banners={[banner("1", "W", "ش", { ctaHref: "javascript:alert(1)" })]} />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/shop?type=new"]);
  });

  it("ADM-06 · the banner has exactly one button, its own CTA (CR-011 Q-3)", () => {
    wrap(locale, <Hero banners={[banner("1", "W", "ش")]} />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/shop?type=new"]);
    expect(links[0].textContent).toBe(locale === "en" ? "Browse" : "تصفح");
  });
});

describe("ADM-06 · safeHref", () => {
  it("ADM-06 · allows same-site paths and https only", () => {
    expect(safeHref("/shop")).toEqual({ href: "/shop", external: false });
    expect(safeHref("https://example.com/x")?.external).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "//evil.com",
      "http://x.com",
      "",
      null,
      "/\\evil.com",
    ]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});

describe.each(["en", "ar"] as const)("ADM-07 · sections (%s)", (locale) => {
  const sections: HomeSection[] = [
    sec("a", "NEW_ARRIVALS", { products: [product("1")] }),
    sec("b", "CATEGORY_GRID", {
      categories: [{ id: "c1", slug: "sofas", name: { en: "Sofas", ar: "أرائك" } }],
    }),
    sec("c", "RESALE_PICKS", { products: [product("2", "RESALE")] }),
    sec("d", "TESTIMONIALS", {
      config: { testimonials: [{ name: "Sara", quote: { en: "Lovely", ar: "رائع" } }] },
    }),
  ];

  it("ADM-07 · composes the category row, ONE shelf, optional sections, then how pre-owned works", () => {
    const { container } = wrap(locale, <HomeSections sections={sections} locale={locale} />);
    const order = Array.from(container.querySelectorAll("[data-testid]"))
      .map((e) => e.getAttribute("data-testid"))
      .filter((x) => ["home-section-CATEGORY_GRID", "home-shelf", "home-section-TESTIMONIALS", "how-resale"].includes(x ?? "")
        || x?.startsWith("home-section-NEW") || x?.startsWith("home-section-RESALE"));
    expect(order).toEqual(["home-section-CATEGORY_GRID", "home-shelf", "home-section-TESTIMONIALS", "how-resale"]);
  });

  it("ADM-07 · localizes titles, shows price and the pre-owned grade chip on the shelf", () => {
    wrap(locale, <HomeSections sections={sections} locale={locale} />);
    expect(screen.getByRole("heading", { name: locale === "en" ? "T-b" : "ع-b" })).toBeTruthy();
    const shelf = screen.getByTestId("home-shelf");
    expect(shelf.textContent).toContain(messages[locale].condition.GOOD);
    expect(shelf.querySelector("bdi")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Sofa 1|أريكة 1/ }).getAttribute("href")).toBe("/shop/p-1");
  });

  it("ADM-07 · hides empty sections (no shelf either)", () => {
    const empty: HomeSection[] = [
      sec("e1", "FEATURED_PRODUCTS", { products: [] }),
      sec("e2", "CATEGORY_GRID", { categories: [] }),
      sec("e3", "PROMO_BANNER"),
      sec("e4", "TESTIMONIALS", { config: { testimonials: [] } }),
    ];
    expect(empty.some(sectionHasContent)).toBe(false);
    const { container } = wrap(locale, <HomeSections sections={empty} locale={locale} />);
    expect(container.querySelector('[data-testid^="home-section-"]')).toBeNull();
    expect(screen.queryByTestId("home-shelf")).toBeNull();
  });

  it("ADM-07 · promo banner renders when resolved; testimonials are quiet static quotes", () => {
    wrap(
      locale,
      <HomeSections
        locale={locale}
        sections={[sec("p", "PROMO_BANNER", { banner: banner("9", "Sale", "تخفيض") }), sections[3]]}
      />,
    );
    expect(screen.getByTestId("home-section-PROMO_BANNER")).toBeTruthy();
    const quotes = screen.getByTestId("testimonials");
    expect(within(quotes).getAllByRole("listitem")).toHaveLength(1);
    expect(quotes.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0); // no duplicated marquee track
  });
});

describe.each(["en", "ar"] as const)("UI-01 · motion (%s)", (locale) => {
  it("UI-01 · reduced motion: content stays visible and testimonials never animate", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    wrap(locale, <Hero banners={[banner("1", "W", "ش"), banner("2", "X", "ص")]} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe("");
    cleanup();
    wrap(
      locale,
      <HomeSections
        locale={locale}
        sections={[
          sec("d", "TESTIMONIALS", {
            config: { testimonials: [{ name: "S", quote: { en: "q", ar: "ق" } }] },
          }),
        ]}
      />,
    );
    const quotes = screen.getByTestId("testimonials");
    expect(quotes.className).not.toMatch(/animate|marquee/);
    expect(quotes.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("UI-01 · how-resale renders 3 localized steps", () => {
    wrap(locale, <HomeSections sections={[]} locale={locale} />);
    const steps = screen.getByTestId("how-resale").querySelectorAll("[data-step]");
    expect(steps).toHaveLength(3);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      messages[locale].home.resale.title,
    );
  });
});
