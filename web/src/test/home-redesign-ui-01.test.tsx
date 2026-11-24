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
  getImageProps: (p: { src: string; alt: string; priority?: boolean; loading?: string }) => ({
    props: {
      src: p.src,
      srcSet: `${p.src} 1x`,
      alt: p.alt,
      "data-priority": p.priority ? "true" : "false",
      "data-loading": p.loading,
      loading: p.priority ? undefined : p.loading,
      fetchPriority: p.priority ? "high" : undefined,
    },
  }),
  default: ({ src, alt, priority, loading }: { src: string; alt: string; priority?: boolean; loading?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} data-priority={priority ? "true" : "false"} data-loading={loading} />
  ),
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

import { SiteFactsProvider } from "@/lib/site-facts";
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

describe.each(["en", "ar"] as const)("UI-04 · hero carousel (%s)", (locale) => {
  const m = messages[locale];
  const h1 = () => screen.getByRole("heading", { level: 1 }).textContent;
  const t1 = locale === "en" ? "Banner 1" : "لافتة 1";
  const t2 = locale === "en" ? "Banner 2" : "لافتة 2";
  const label = (key: string, vars: Record<string, string> = {}) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), (m.home.carousel as unknown as Record<string, string>)[key]!);

  it(`UI-04 · a full-bleed carousel region, 85vh on desktop and 70vh on mobile, no arch (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    const hero = screen.getByTestId("home-hero");
    expect(hero.getAttribute("aria-roledescription")).toBe("carousel");
    expect(hero.getAttribute("aria-label")).toBe(m.home.carousel.label);
    expect(hero.className).toContain("h-[70vh]");
    expect(hero.className).toContain("md:h-[85vh]");
    expect(hero.className).toContain("min-h-[480px]");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(h1()).toBe(t1);
    expect(screen.queryByTestId("arch")).toBeNull();
    expect(hero.className).not.toContain("max-w-"); // full bleed
  });

  it(`UI-04 · every slide is a labelled group; inactive slides are hidden, inert and faded out (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    const slides = screen.getByTestId("home-hero").querySelectorAll("[data-active]");
    expect(slides).toHaveLength(2);
    expect(slides[0].getAttribute("aria-roledescription")).toBe("slide");
    expect(slides[0].getAttribute("aria-label")).toBe(label("slide", { n: "1", total: "2" }));
    expect(slides[1].getAttribute("aria-label")).toBe(label("slide", { n: "2", total: "2" }));
    expect(slides[0].getAttribute("aria-hidden")).toBeNull();
    expect(slides[1].getAttribute("aria-hidden")).toBe("true");
    expect(slides[1].hasAttribute("inert")).toBe(true);
    expect(slides[1].className).toContain("opacity-0");
    expect(slides[0].className).toContain("duration-700"); // crossfade 700 ms
  });

  it(`UI-04 · an admin banner has exactly one button (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1")]} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/shop");
    expect(links[0].textContent).toBe(locale === "en" ? "Shop" : "تسوق");
  });

  it(`UI-04 · the fallback has three static slides with their approved copy and two buttons (${locale})`, () => {
    wrap(locale, <HeroFallback />);
    expect(screen.getByTestId("home-fallback-hero")).toBeTruthy();
    expect(h1()).toBe(m.home.carousel.s1.title);
    const hero = screen.getByTestId("home-fallback-hero");
    expect(hero.querySelectorAll("[data-active]")).toHaveLength(3);
    const first = hero.querySelector("[data-active='true']")!;
    expect(within(first as HTMLElement).getAllByRole("link").map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
      ["/shop?type=new", m.home.carousel.s1.cta],
      ["/shop", m.home.carousel.s1.cta2],
    ]);
  });

  it(`UI-04 · static slide 3 says how many cities deliver, computed, and shows no line without a count (${locale})`, () => {
    const { unmount } = wrap(locale, <SiteFactsProvider cityCount={6}><HeroFallback /></SiteFactsProvider>);
    const lines = [...screen.getByTestId("home-fallback-hero").querySelectorAll("p.mt-4")].map((p) => p.textContent);
    expect(lines).toContain(locale === "en" ? "Cash on delivery in 6 Saudi cities." : "الدفع نقدًا عند التسليم في 6 مدن سعودية.");
    expect(lines.join(" ")).not.toMatch(/across Saudi|across our|all cities|أنحاء|جميع مدن|كل مدن|مدننا/);
    unmount();
    wrap(locale, <HeroFallback />);
    const none = [...screen.getByTestId("home-fallback-hero").querySelectorAll("p.mt-4")].map((p) => p.textContent);
    expect(none).toHaveLength(2); // slides 1 and 2 keep their lines; slide 3 has none
  });

  it(`UI-04 · only slide 1 loads with the page and has priority; the next slide's photo mounts later, lazy (${locale})`, () => {
    vi.useFakeTimers();
    wrap(locale, <Hero banners={[banner("1"), banner("2"), banner("3")]} />);
    const imgs = () => [...screen.getByTestId("home-hero").querySelectorAll("img")];
    expect(imgs().map((i) => i.getAttribute("data-priority"))).toEqual(["true"]);
    act(() => void vi.advanceTimersByTime(4100));
    expect(imgs().map((i) => i.getAttribute("data-priority"))).toEqual(["true", "false"]); // slide 2 only
    expect(imgs()[1].getAttribute("data-loading")).toBe("lazy");
    fireEvent.click(screen.getByRole("button", { name: m.home.carousel.next }));
    expect(imgs()).toHaveLength(3); // seen slides stay mounted, slide 3 is now next
  });

  it(`UI-04 · the first slide image is eager with high fetch priority and exactly one image per slide, mobile via <source> (${locale})`, () => {
    const withMobile = { ...banner("1"), imageMobile: { url: "https://cdn.test/m1.jpg", alt: { en: "m", ar: "م" } } } as Banner;
    wrap(locale, <Hero banners={[withMobile, banner("2")]} />);
    const hero = screen.getByTestId("home-hero");
    const imgs = [...hero.querySelectorAll("img")];
    expect(imgs).toHaveLength(1); // the mobile photo is a <source>, not a second (hidden) image
    expect(imgs[0].getAttribute("src")).toBe("https://cdn.test/1.jpg");
    expect(imgs[0].getAttribute("fetchpriority")).toBe("high");
    expect(imgs[0].getAttribute("loading")).toBe("eager"); // not lazy: nothing delays the LCP image
    expect(imgs[0].className).not.toMatch(/hidden|opacity-0/);
    const source = hero.querySelector("picture source")!;
    expect(source.getAttribute("media")).toBe("(max-width: 767px)");
    expect(source.getAttribute("srcset")).toContain("https://cdn.test/m1.jpg");
  });

  it(`UI-04 · an admin banner photo uses the banner title as its alt text; static slides are decorative (${locale})`, () => {
    const withMobile = { ...banner("1"), imageMobile: { url: "https://cdn.test/m1.jpg", alt: { en: "other", ar: "آخر" } } } as Banner;
    const { unmount } = wrap(locale, <Hero banners={[withMobile]} />);
    expect(screen.getByRole("img").getAttribute("alt")).toBe(locale === "en" ? "Banner 1" : "لافتة 1");
    unmount();
    wrap(locale, <HeroFallback />);
    const hero = screen.getByTestId("home-fallback-hero");
    expect([...hero.querySelectorAll("img")].every((i) => i.getAttribute("alt") === "")).toBe(true);
  });

  it(`UI-04 · the hero has a top scrim so the light header text over it stays readable (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1")]} />);
    const scrim = screen.getByTestId("home-hero").querySelector(".bg-gradient-to-b");
    expect(scrim?.className).toContain("from-foreground/60");
  });

  it(`UI-04 · the hero has a branded gradient behind the photo, never a plain dark void (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1")]} />);
    const cls = screen.getByTestId("home-hero").className;
    expect(cls).toContain("bg-gradient-to-br");
    expect(cls).toContain("from-primary");
  });

  it(`UI-04 · the progress bar is the timer: it runs 6 s and its end advances the slide, wrapping at the last (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    const bar = () => screen.getByTestId("hero-progress");
    const end = () => {
      fireEvent.animationEnd(bar());
      fireEvent(bar(), new Event("webkitAnimationEnd", { bubbles: true }));
    };
    expect(bar().className).toContain("hero-bar");
    expect(h1()).toBe(t1);
    end();
    expect(h1()).toBe(t2);
    end();
    expect(h1()).toBe(t1);
  });

  it(`UI-04 · hover and focus pause the animations; a visible pause button pauses and resumes them (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    const hero = screen.getByTestId("home-hero");
    const state = () => (screen.getByTestId("hero-progress") as HTMLElement).style.animationPlayState;
    expect(state()).toBe("running");
    fireEvent.mouseEnter(hero);
    expect(state()).toBe("paused");
    fireEvent.mouseLeave(hero);
    expect(state()).toBe("running");
    fireEvent.focus(hero);
    expect(state()).toBe("paused");
    fireEvent.blur(hero);
    expect(state()).toBe("running");
    const pause = screen.getByRole("button", { name: m.home.carousel.pause });
    expect(pause.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pause);
    fireEvent.mouseLeave(hero);
    expect(state()).toBe("paused");
    const play = screen.getByRole("button", { name: m.home.carousel.play });
    expect(play.getAttribute("aria-pressed")).toBe("true");
    expect(hero.querySelector("[aria-live]")!.getAttribute("aria-live")).toBe("polite"); // paused: announce changes
    fireEvent.click(play);
    expect(state()).toBe("running");
    expect(hero.querySelector("[aria-live]")!.getAttribute("aria-live")).toBe("off");
  });

  it(`UI-04 · reduced motion: no autoplay, no zoom, no pause button, arrows and bars still work (${locale})`, () => {
    setReduced(true);
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    const hero = screen.getByTestId("home-hero");
    expect(hero.querySelector(".hero-bar")).toBeNull();
    expect(hero.querySelector(".hero-zoom")).toBeNull();
    expect(screen.queryByRole("button", { name: m.home.carousel.pause })).toBeNull();
    expect(h1()).toBe(t1);
    fireEvent.click(screen.getByRole("button", { name: m.home.carousel.next }));
    expect(h1()).toBe(t2);
    fireEvent.click(screen.getByRole("button", { name: label("goTo", { n: "1" }) }));
    expect(h1()).toBe(t1);
  });

  it(`UI-04 · slow zoom runs on the active slide only (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    expect(screen.getByTestId("home-hero").querySelectorAll(".hero-zoom")).toHaveLength(1);
  });

  it(`UI-04 · arrow buttons and keyboard arrows move between slides, mirrored in RTL (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1"), banner("2"), banner("3")]} />);
    const hero = screen.getByTestId("home-hero");
    fireEvent.click(screen.getByRole("button", { name: m.home.carousel.next }));
    expect(h1()).toBe(t2);
    fireEvent.click(screen.getByRole("button", { name: m.home.carousel.previous }));
    expect(h1()).toBe(t1);
    const forward = locale === "ar" ? "ArrowLeft" : "ArrowRight";
    const back = locale === "ar" ? "ArrowRight" : "ArrowLeft";
    fireEvent.keyDown(hero, { key: forward });
    expect(h1()).toBe(t2);
    fireEvent.keyDown(hero, { key: back });
    expect(h1()).toBe(t1);
  });

  it(`UI-04 · swiping changes slide, in the reading direction of the locale (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    const hero = screen.getByTestId("home-hero");
    const swipe = (from: number, to: number) => {
      fireEvent.touchStart(hero, { touches: [{ clientX: from }] });
      fireEvent.touchEnd(hero, { changedTouches: [{ clientX: to }] });
    };
    swipe(200, 195); // too short: ignored
    expect(h1()).toBe(t1);
    if (locale === "en") swipe(300, 100);
    else swipe(100, 300);
    expect(h1()).toBe(t2);
  });
});

describe.each(["en", "ar"] as const)("UI-01 · home v2 category row and shelf (%s)", (locale) => {
  const m = messages[locale];
  const both = [
    section("n", "NEW_ARRIVALS", { products: [product("1", "NEW")] }),
    section("r", "RESALE_PICKS", { products: [product("2", "RESALE")] }),
  ];

  const five = section("c5", "CATEGORY_GRID", {
    categories: [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `k${n}`,
      slug: `cat-${n}`,
      name: { en: `Cat ${n}`, ar: `فئة ${n}` },
      image: n === 2 ? null : { url: `https://cdn.test/c${n}.jpg` },
      productCount: n === 1 ? 12 : n === 3 ? 1 : 0,
    })),
  });

  it(`UI-04 · categories are a bento grid: one large tile, four small, no scroll row, no arch (${locale})`, () => {
    wrap(locale, <HomeSections sections={[five]} locale={locale} />);
    const grid = screen.getByTestId("category-grid");
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("lg:grid-cols-4");
    expect(grid.className).not.toMatch(/overflow-x|snap-/);
    expect(screen.queryByTestId("category-row")).toBeNull();
    expect(screen.queryByTestId("arch")).toBeNull();
    const tiles = within(grid).getAllByRole("listitem");
    expect(tiles).toHaveLength(5); // the sixth category is not shown
    expect(tiles[0].className).toContain("col-span-2");
    expect(tiles[0].className).toContain("lg:row-span-2");
    for (const tile of tiles.slice(1)) expect(tile.className).not.toContain("col-span-2");
    const first = within(tiles[0]).getByRole("link");
    expect(first.getAttribute("href")).toBe("/shop?category=cat-1");
    expect(first.className).toContain("zoom-on-hover");
    expect(first.className).toContain("rounded-lg");
  });

  it(`UI-04 · a tile shows a dark gradient, the name in the heading font and the product count (${locale})`, () => {
    wrap(locale, <HomeSections sections={[five]} locale={locale} />);
    const tiles = within(screen.getByTestId("category-grid")).getAllByRole("listitem");
    const name = within(tiles[0]).getByText(locale === "en" ? "Cat 1" : "فئة 1");
    expect(name.className).toContain("font-display");
    expect(tiles[0].querySelector(".bg-gradient-to-t")).toBeTruthy();
    expect(within(tiles[0]).getByText(locale === "en" ? "12 products" : "12 منتجًا")).toBeTruthy();
    expect(within(tiles[2]).getByText(locale === "en" ? "1 product" : "منتج واحد")).toBeTruthy();
    expect(within(tiles[3]).getByText(locale === "en" ? "0 products" : "لا منتجات")).toBeTruthy();
  });

  it(`UI-04 · a category without a photo gets a static fallback photo, never an empty block (${locale})`, () => {
    wrap(locale, <HomeSections sections={[five]} locale={locale} />);
    const tiles = within(screen.getByTestId("category-grid")).getAllByRole("listitem");
    expect(tiles[1].querySelector("img")?.getAttribute("src")).toBe("/home/cat-2.jpg");
    expect(tiles[0].querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/c1.jpg");
  });

  it(`UI-04 · a "view all categories" link goes to the shop (${locale})`, () => {
    wrap(locale, <HomeSections sections={[five]} locale={locale} />);
    expect(screen.getByRole("link", { name: m.home.categories.viewAll }).getAttribute("href")).toBe("/shop");
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
