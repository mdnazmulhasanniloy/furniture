// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "ar" }));
const messages = { en, ar } as const;
const addToCart = vi.hoisted(() => vi.fn(async () => true));

vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  getTranslations: async (ns: string) => createTranslator({ locale: state.locale, messages: messages[state.locale], namespace: ns as never }),
}));
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
vi.mock("@/lib/cart/store", () => ({ addToCart }));
vi.mock("@/lib/cart/fly", () => ({ flyToCart: vi.fn() }));

import { HomeSections } from "@/components/home/home-sections";
import { ShopTheLook } from "@/components/home/shop-the-look";
import { TrustStrip } from "@/components/home/trust-strip";
import type { HomeProduct, HomeSection, SiteSettings } from "@/lib/api/public";
import { sectionHasContent } from "@/lib/home";

const product = (id: string, stock = 3): HomeProduct => ({
  id,
  slug: `p-${id}`,
  title: { en: `Lamp ${id}`, ar: `مصباح ${id}` },
  type: "NEW",
  condition: "NEW",
  price: 45000,
  stock,
  images: [{ url: `https://cdn.test/${id}.jpg` }],
});
const look = (extra: Partial<HomeSection> = {}): HomeSection => ({
  id: "l1",
  type: "SHOP_THE_LOOK",
  title: { en: "Shop the room", ar: "تسوّق الغرفة" },
  look: {
    image: { url: "https://cdn.test/room.jpg", alt: { en: "A living room", ar: "غرفة معيشة" } },
    hotspots: [
      { x: 20, y: 30, product: product("1") },
      { x: 80, y: 70, product: product("2", 0) },
    ],
  },
  ...extra,
});

const wrap = (locale: "en" | "ar", ui: React.ReactNode) => {
  state.locale = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
};
afterEach(() => {
  cleanup();
  addToCart.mockClear();
});

describe.each(["en", "ar"] as const)("ADM-15 · shop the look (%s)", (locale) => {
  const m = messages[locale];

  it(`ADM-15 · hotspots are buttons placed in percent on the photo, in physical coordinates (${locale})`, () => {
    wrap(locale, <ShopTheLook section={look()} locale={locale} />);
    const spots = screen.getAllByTestId("hotspot");
    expect(spots).toHaveLength(2);
    const holder = spots[0].parentElement as HTMLElement;
    expect(holder.style.left).toBe("20%"); // the photo is not mirrored in RTL, so neither are its dots
    expect(holder.style.top).toBe("30%");
    expect(spots[0].getAttribute("aria-label")).toBe(m.home.look.hotspot.replace("{name}", locale === "en" ? "Lamp 1" : "مصباح 1"));
    expect(spots[0].getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(locale === "en" ? "Shop the room" : "تسوّق الغرفة");
    expect(screen.getByText(m.home.look.hint)).toBeTruthy();
    expect(screen.getByTestId("look-photo").className).toContain("aspect-[4/5]");
    expect(screen.getByTestId("look-photo").className).toContain("sm:aspect-[16/9]");
  });

  it(`ADM-15 · activating a hotspot opens a product card; one at a time; Escape closes and returns focus (${locale})`, () => {
    wrap(locale, <ShopTheLook section={look()} locale={locale} />);
    const [a, b] = screen.getAllByTestId("hotspot");
    fireEvent.click(a);
    expect(a.getAttribute("aria-expanded")).toBe("true");
    const card = screen.getByTestId("look-card");
    expect(a.getAttribute("aria-controls")).toBe(card.id);
    expect(card.textContent).toContain(locale === "en" ? "Lamp 1" : "مصباح 1");
    fireEvent.click(b);
    expect(screen.getAllByTestId("look-card")).toHaveLength(1);
    expect(a.getAttribute("aria-expanded")).toBe("false");
    expect(b.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("look-card")).toBeNull();
    expect(document.activeElement).toBe(b);
  });

  it(`ADM-15 · the card adds to the cart, and a sold-out product cannot be added (${locale})`, () => {
    wrap(locale, <ShopTheLook section={look()} locale={locale} />);
    const [a, b] = screen.getAllByTestId("hotspot");
    fireEvent.click(a);
    fireEvent.click(screen.getByRole("button", { name: m.cart.addToCart }));
    expect(addToCart).toHaveBeenCalledTimes(1);
    fireEvent.click(b);
    expect((screen.getByRole("button", { name: m.badge.soldOut }) as HTMLButtonElement).disabled).toBe(true);
  });

  it(`ADM-15 · the card flips toward the middle of the photo so it never leaves it (${locale})`, () => {
    wrap(locale, <ShopTheLook section={look()} locale={locale} />);
    const [a, b] = screen.getAllByTestId("hotspot");
    fireEvent.click(a); // x 20, y 30: opens to the right and below
    expect(screen.getByTestId("look-card").className).toMatch(/left-0/);
    expect(screen.getByTestId("look-card").className).toMatch(/top-8/);
    fireEvent.click(b); // x 80, y 70: opens to the left and above
    expect(screen.getByTestId("look-card").className).toMatch(/right-0/);
    expect(screen.getByTestId("look-card").className).toMatch(/bottom-8/);
  });

  it(`ADM-15 · it is rendered by the home composition only when a look has a photo and a hotspot (${locale})`, () => {
    expect(sectionHasContent(look())).toBe(true);
    expect(sectionHasContent(look({ look: { image: { url: "" }, hotspots: [] } }))).toBe(false);
    expect(sectionHasContent({ ...look(), look: undefined })).toBe(false);
    const { unmount } = wrap(locale, <HomeSections sections={[look()]} locale={locale} />);
    expect(screen.getByTestId("home-section-SHOP_THE_LOOK")).toBeTruthy();
    unmount();
    wrap(locale, <HomeSections sections={[look({ look: { image: { url: "https://cdn.test/x.jpg" }, hotspots: [] } })]} locale={locale} />);
    expect(screen.queryByTestId("home-section-SHOP_THE_LOOK")).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("UI-04 · trust strip (%s)", (locale) => {
  const settings = (extra: Partial<SiteSettings> = {}): SiteSettings => ({
    deliveryCities: [
      { code: "jeddah", name: { en: "Jeddah", ar: "جدة" }, isActive: true, sortOrder: 2 },
      { code: "riyadh", name: { en: "Riyadh", ar: "الرياض" }, isActive: true, sortOrder: 1 },
      { code: "gone", name: { en: "Gone", ar: "ذهب" }, isActive: false, sortOrder: 3 },
    ],
    ...extra,
  } as SiteSettings);
  const m = messages[locale];

  it(`UI-04 · it states cash on delivery and the ACTIVE cities by name, in sort order (${locale})`, async () => {
    state.locale = locale;
    render(await TrustStrip({ settings: settings() }));
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toHaveLength(2); // no free-delivery fact without a threshold
    expect(items[0]).toBe(m.home.trust.cod);
    expect(items[1]).toContain(locale === "en" ? "Riyadh" : "الرياض");
    expect(items[1]).toContain(locale === "en" ? "Jeddah" : "جدة");
    expect(items[1]).not.toContain(locale === "en" ? "Gone" : "ذهب");
    expect(items.join(" ")).not.toMatch(/across Saudi|all cities|أنحاء|جميع مدن/);
  });

  it(`UI-04 · free delivery appears only when a threshold is set (${locale})`, async () => {
    state.locale = locale;
    render(await TrustStrip({ settings: settings({ freeDeliveryThreshold: 50000 }) }));
    const items = screen.getAllByRole("listitem").map((li) => li.textContent!);
    expect(items).toHaveLength(3);
    expect(items[2]).toMatch(/500/);
  });

  it(`UI-04 · with no settings it still says cash on delivery and nothing it cannot back (${locale})`, async () => {
    state.locale = locale;
    render(await TrustStrip({ settings: null }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([m.home.trust.cod]);
  });
});

describe("UI-04 · pre-owned steps no longer contradict cash on delivery", () => {
  it("UI-04 · the third step says you pay when it arrives (en and ar)", () => {
    expect(en.home.resale.steps.deliver.title).toBe("You pay when it arrives");
    expect(en.home.resale.steps.deliver.body).not.toMatch(/at checkout/i);
    expect(ar.home.resale.steps.deliver.title).toBe("تدفع عند وصولها");
  });
});
