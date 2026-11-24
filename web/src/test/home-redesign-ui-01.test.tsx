// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
vi.mock("@/lib/cart/store", () => ({ addToCart: vi.fn(async () => true) }));

// One chainable timeline: every call is recorded so the test can read the choreography.
const gsapMock = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const timeline = {} as Record<string, unknown>;
  for (const method of ["fromTo", "from", "to", "set"]) {
    timeline[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return timeline;
    };
  }
  const gsap = {
    calls,
    timelineOptions: [] as unknown[],
    revert: vi.fn(),
    timeline: (opts: unknown) => {
      gsap.timelineOptions.push(opts);
      return timeline;
    },
    context: (fn: () => void) => {
      fn();
      return { revert: gsap.revert };
    },
    registerPlugin: vi.fn(),
  };
  return gsap;
});
vi.mock("gsap", () => ({ gsap: gsapMock, default: gsapMock }));

import { Hero, HeroFallback } from "@/components/home/hero";
import { HomeSections } from "@/components/home/home-sections";
import type { Banner, HomeProduct, HomeSection } from "@/lib/api/public";

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
const setReduced = (reduced: boolean) => {
  window.matchMedia = ((q: string) =>
    ({ matches: reduced && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
};
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

beforeEach(() => {
  gsapMock.calls.length = 0;
  gsapMock.timelineOptions.length = 0;
  gsapMock.revert.mockClear();
  setReduced(false);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  // @ts-expect-error jsdom has no matchMedia; remove the stub
  delete window.matchMedia;
});

const banner = (id: string, cta: string | null = "/shop"): Banner =>
  ({
    id,
    title: { en: `Banner ${id}`, ar: `لافتة ${id}` },
    subtitle: { en: `Sub ${id}`, ar: `فرعي ${id}` },
    imageDesktop: { url: `https://cdn.test/${id}.jpg`, alt: { en: "a", ar: "أ" } },
    ctaLabel: { en: "Shop", ar: "تسوق" },
    ctaHref: cta,
  }) as unknown as Banner;

const product = (id: string, type: "NEW" | "RESALE"): HomeProduct => ({
  id,
  slug: `p-${id}`,
  title: { en: `Item ${id}`, ar: `قطعة ${id}` },
  type,
  condition: type === "NEW" ? "NEW" : "GOOD",
  price: 100000,
  stock: 2,
  images: [{ url: `https://cdn.test/${id}.jpg` }],
});

const section = (id: string, type: HomeSection["type"], extra: Partial<HomeSection> = {}): HomeSection => ({
  id,
  type,
  title: { en: `S-${id}`, ar: `ق-${id}` },
  ...extra,
});

describe.each(["en", "ar"] as const)("UI-01 · home v2 hero (%s)", (locale) => {
  const m = messages[locale];

  it(`UI-01 · the hero is a light display headline beside a gold-outlined 4:5 arch (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1")]} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toContain("type-hero");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId("arch").className).toContain("aspect-[4/5]");
    expect(screen.getByTestId("arch-outline")).toBeTruthy();
  });

  it(`UI-01 · two actions: an emerald primary and an outlined Shop pre-owned (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1")]} />);
    const [primary, secondary] = screen.getAllByRole("link");
    expect(primary.className).toContain("bg-primary");
    expect(primary.className).not.toContain("shimmer");
    expect(secondary.className).toContain("border-primary");
    expect(secondary.getAttribute("href")).toBe("/shop?type=resale");
    expect(secondary.textContent).toBe(m.home.hero.shopResale);
  });

  it(`UI-01 · the fallback hero (no banners) keeps the same composition and default copy (${locale})`, () => {
    wrap(locale, <HeroFallback />);
    expect(screen.getByTestId("home-fallback-hero")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(m.home.hero.headline);
    expect(screen.getByTestId("arch-outline")).toBeTruthy();
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/shop?type=new", "/shop?type=resale"]);
  });

  it(`UI-01 · the single GSAP moment: arch clip, gold outline draw, headline settles 16 px (${locale})`, async () => {
    wrap(locale, <Hero banners={[banner("1")]} />);
    await flush();
    expect(gsapMock.timelineOptions).toHaveLength(1);
    const steps = gsapMock.calls.map((c) => [c.method, c.args[0]]);
    expect(steps).toEqual([
      ["fromTo", "[data-arch-reveal]"],
      ["fromTo", "[data-arch-outline]"],
      ["from", "[data-hero-line]"],
    ]);
    const reveal = gsapMock.calls[0].args as [string, { clipPath: string }, { clipPath: string; duration: number }];
    expect(reveal[1].clipPath).toBe("inset(100% 0% 0% 0%)"); // grows from the base
    expect(reveal[2].duration).toBe(0.7);
    const lines = gsapMock.calls[2].args as [string, { y: number; opacity: number }];
    expect(lines[1]).toMatchObject({ y: 16, opacity: 0 });
    // Vertical only: nothing is offset horizontally, so RTL needs no mirroring.
    expect(JSON.stringify(gsapMock.calls)).not.toMatch(/"x"|xPercent/);
  });

  it(`UI-01 · no GSAP, no animation of any kind under reduced motion (${locale})`, async () => {
    setReduced(true);
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    await flush();
    expect(gsapMock.timelineOptions).toHaveLength(0);
    expect(gsapMock.calls).toHaveLength(0);
  });

  it(`UI-01 · the timeline is reverted on unmount and does not rerun on slide change (${locale})`, async () => {
    const { unmount } = wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: m.home.hero.goTo.replace("{n}", "2") }));
    await flush();
    expect(gsapMock.timelineOptions).toHaveLength(1);
    unmount();
    expect(gsapMock.revert).toHaveBeenCalled();
  });

  it(`UI-01 · slides crossfade stacked in the arch; inactive slides are hidden from assistive tech (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    const slides = screen.getByTestId("arch").querySelectorAll("[data-active]");
    expect(slides).toHaveLength(2);
    expect(slides[0].getAttribute("aria-hidden")).toBeNull();
    expect(slides[1].getAttribute("aria-hidden")).toBe("true");
    expect(slides[1].className).toContain("opacity-0");
    expect(slides[0].className).toContain("transition-opacity");
  });

  it(`UI-01 · rotates every 7 s, pauses on hover and focus (${locale})`, () => {
    vi.useFakeTimers();
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    const h1 = () => screen.getByRole("heading", { level: 1 }).textContent;
    expect(h1()).toBe(locale === "en" ? "Banner 1" : "لافتة 1");
    act(() => void vi.advanceTimersByTime(6900));
    expect(h1()).toBe(locale === "en" ? "Banner 1" : "لافتة 1");
    act(() => void vi.advanceTimersByTime(200));
    expect(h1()).toBe(locale === "en" ? "Banner 2" : "لافتة 2");
    const hero = screen.getByTestId("home-hero");
    fireEvent.mouseEnter(hero);
    act(() => void vi.advanceTimersByTime(20000));
    expect(h1()).toBe(locale === "en" ? "Banner 2" : "لافتة 2");
    fireEvent.mouseLeave(hero);
    fireEvent.focus(hero);
    act(() => void vi.advanceTimersByTime(20000));
    expect(h1()).toBe(locale === "en" ? "Banner 2" : "لافتة 2");
  });

  it(`UI-01 · no auto-rotation under reduced motion, manual dots only (${locale})`, () => {
    setReduced(true);
    vi.useFakeTimers();
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    act(() => void vi.advanceTimersByTime(30000));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(locale === "en" ? "Banner 1" : "لافتة 1");
    fireEvent.click(screen.getByRole("button", { name: m.home.hero.goTo.replace("{n}", "2") }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(locale === "en" ? "Banner 2" : "لافتة 2");
  });
});

describe.each(["en", "ar"] as const)("UI-01 · home v2 category row and shelf (%s)", (locale) => {
  const m = messages[locale];
  const cats = section("c1", "CATEGORY_GRID", {
    categories: [
      { id: "k1", slug: "sofas", name: { en: "Sofas", ar: "أرائك" }, image: { url: "https://cdn.test/k.jpg" } },
      { id: "k2", slug: "beds", name: { en: "Beds", ar: "أسرّة" }, image: null },
    ],
  });
  const both = [
    section("n", "NEW_ARRIVALS", { products: [product("1", "NEW")] }),
    section("r", "RESALE_PICKS", { products: [product("2", "RESALE")] }),
  ];

  it(`UI-01 · categories are a scroll-snap row of 3:4 arches with the name under each (${locale})`, () => {
    wrap(locale, <HomeSections sections={[cats]} locale={locale} />);
    const row = screen.getByTestId("category-row");
    expect(row.className).toContain("snap-x");
    expect(row.className).toContain("overflow-x-auto");
    const tiles = within(row).getAllByRole("listitem");
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.className).toContain("snap-start");
      expect(within(tile).getByTestId("arch").className).toContain("aspect-[3/4]");
      expect(within(tile).queryByTestId("arch-outline")).toBeNull(); // the gold outline is a hero detail
    }
    expect(within(row).getByRole("link", { name: locale === "en" ? "Sofas" : "أرائك" }).getAttribute("href")).toBe("/shop?category=sofas");
  });

  it(`UI-01 · a category without an image gets a flat sand placeholder inside the arch (${locale})`, () => {
    wrap(locale, <HomeSections sections={[cats]} locale={locale} />);
    const ph = screen.getByTestId("image-placeholder");
    expect(ph.getAttribute("aria-label")).toBe(m.home.brand);
    expect(ph.className).toContain("bg-muted");
    expect(ph.className).not.toMatch(/pattern|gradient/);
  });

  it(`UI-01 · ONE shelf with a New / Pre-owned switch; New is selected first (${locale})`, () => {
    wrap(locale, <HomeSections sections={both} locale={locale} />);
    expect(screen.getAllByTestId("home-shelf")).toHaveLength(1);
    const tabs = screen.getAllByRole("tab");
    expect(screen.getByRole("tab", { name: m.nav.new })).toBe(tabs[0]);
    expect(screen.getByRole("tab", { name: m.nav.resale })).toBe(tabs[1]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain(locale === "en" ? "Item 1" : "قطعة 1");
    expect(screen.getByRole("link", { name: m.home.shelf.seeAllNew }).getAttribute("href")).toBe("/shop?type=new");
  });

  it(`UI-01 · clicking Pre-owned swaps the panel and the see-all link (${locale})`, () => {
    wrap(locale, <HomeSections sections={both} locale={locale} />);
    fireEvent.click(screen.getByRole("tab", { name: m.nav.resale }));
    expect(screen.getByRole("tabpanel").textContent).toContain(locale === "en" ? "Item 2" : "قطعة 2");
    expect(screen.getByRole("link", { name: m.home.shelf.seeAllResale }).getAttribute("href")).toBe("/shop?type=resale");
  });

  it(`UI-01 · arrow keys move between the two options and follow the reading direction (${locale})`, () => {
    wrap(locale, <HomeSections sections={both} locale={locale} />);
    const [first, second] = screen.getAllByRole("tab");
    first.focus();
    // LTR: ArrowRight goes to the next option; RTL: the next option is on the left.
    fireEvent.keyDown(first, { key: locale === "en" ? "ArrowRight" : "ArrowLeft" });
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "Home" });
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(second.getAttribute("tabindex")).toBe("-1");
  });

  it(`UI-01 · the active option is filled ink (${locale})`, () => {
    wrap(locale, <HomeSections sections={both} locale={locale} />);
    expect(screen.getByTestId("shelf-pill").className).toContain("bg-foreground");
  });

  it(`UI-01 · the shelf falls back to the newest products per type when the admin has no section (${locale})`, () => {
    wrap(locale, <HomeSections sections={[]} locale={locale} fallback={{ new: [product("7", "NEW")], resale: [product("8", "RESALE")] }} />);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tabpanel").textContent).toContain(locale === "en" ? "Item 7" : "قطعة 7");
  });

  it(`UI-01 · the switch splits by product type even when one admin section mixes both (${locale})`, () => {
    const mixed = section("m", "NEW_ARRIVALS", { products: [product("1", "NEW"), product("2", "RESALE"), product("1", "NEW")] });
    wrap(locale, <HomeSections sections={[mixed]} locale={locale} />);
    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toContain(locale === "en" ? "Item 1" : "قطعة 1");
    expect(panel.textContent).not.toContain(locale === "en" ? "Item 2" : "قطعة 2"); // the pre-owned piece is not under New
    expect(panel.querySelectorAll("li")).toHaveLength(1); // and the duplicate is shown once
    fireEvent.click(screen.getByRole("tab", { name: m.nav.resale }));
    expect(screen.getByRole("tabpanel").textContent).toContain(locale === "en" ? "Item 2" : "قطعة 2");
  });

  it(`UI-01 · a configured section wins over the fallback (${locale})`, () => {
    wrap(locale, <HomeSections sections={[both[0]]} locale={locale} fallback={{ new: [product("7", "NEW")] }} />);
    expect(screen.getByTestId("home-shelf").textContent).toContain(locale === "en" ? "Item 1" : "قطعة 1");
    expect(screen.getByTestId("home-shelf").textContent).not.toContain(locale === "en" ? "Item 7" : "قطعة 7");
  });

  it(`UI-01 · one non-empty list shows a plain title, no switch (${locale})`, () => {
    wrap(locale, <HomeSections sections={[both[1]]} locale={locale} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByTestId("home-shelf").textContent).toContain(m.nav.resale);
  });

  it(`UI-01 · products of an enabled FEATURED section carry the Featured chip on the shelf (${locale})`, () => {
    const featured = section("f", "FEATURED_PRODUCTS", { products: [product("1", "NEW")] });
    wrap(locale, <HomeSections sections={[both[0], featured]} locale={locale} />);
    const shelf = screen.getByTestId("home-shelf");
    expect(shelf.textContent).toContain(m.badge.featured);
    // ...and the section itself renders below the shelf in the same quiet style.
    expect(screen.getByTestId("home-section-FEATURED_PRODUCTS")).toBeTruthy();
  });

  it(`UI-01 · how pre-owned works is static: three steps, gold hairline, no GSAP (${locale})`, async () => {
    wrap(locale, <HomeSections sections={[]} locale={locale} />);
    await flush();
    const steps = screen.getByTestId("how-resale").querySelectorAll("[data-step]");
    expect(steps).toHaveLength(3);
    steps.forEach((s) => expect(s.className).toContain("border-gold"));
    expect(gsapMock.calls).toHaveLength(0);
    expect(gsapMock.timelineOptions).toHaveLength(0);
  });
});

describe("UI-01 · removed v1 motion and blocks (ADR-015)", () => {
  it("UI-01 · no AOS, scroll reveals, page transition, marquee, shimmer, contact strip or ScrollTrigger remain in the source", async () => {
    const { existsSync, readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const src = path.resolve(import.meta.dirname, "..");
    for (const gone of [
      "components/aos-init.tsx",
      "components/home/home-reveals.tsx",
      "components/home/contact-strip.tsx",
      "app/[locale]/template.tsx",
    ]) {
      expect(existsSync(path.join(src, gone)), gone).toBe(false);
    }
    const files = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (e.name === "test" ? [] : files(path.join(d, e.name))) : /\.(tsx?|css)$/.test(e.name) ? [path.join(d, e.name)] : [],
      );
    const offenders = files(src).filter((f) =>
      /from "aos"|data-aos|data-reveal|animate-marquee|\.shimmer|pattern-emerald|gsap\/ScrollTrigger|ContactStrip/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
