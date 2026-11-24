// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

const gsapMock = vi.hoisted(() => ({
  registerPlugin: vi.fn(),
  matchMedia: () => ({ add: (_q: string, fn: () => void) => fn(), revert: vi.fn() }),
  from: vi.fn(),
  to: vi.fn(),
  fromTo: vi.fn(),
  set: vi.fn(),
  timeline: vi.fn(() => ({ to: vi.fn() })),
  utils: { toArray: (s: string) => Array.from(document.querySelectorAll(s)) },
}));
vi.mock("gsap", () => ({ gsap: gsapMock, default: gsapMock }));
vi.mock("gsap/ScrollTrigger", () => ({ ScrollTrigger: {} }));
const aosInit = vi.hoisted(() => vi.fn());
vi.mock("aos", () => ({ default: { init: aosInit } }));
vi.mock("aos/dist/aos.css", () => ({}));

import { AosInit } from "@/components/aos-init";
import { ContactStrip } from "@/components/home/contact-strip";
import { Hero } from "@/components/home/hero";
import { HomeReveals } from "@/components/home/home-reveals";
import { HomeSections } from "@/components/home/home-sections";
import Template from "@/app/[locale]/template";
import type { Banner, HomeSection } from "@/lib/api/public";

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
const reduce = () => {
  window.matchMedia = ((q: string) =>
    ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
};
const allowMotion = () => {
  window.matchMedia = ((q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
};

beforeEach(() => {
  Object.values(gsapMock).forEach((f) => typeof f === "function" && "mockClear" in f && (f as ReturnType<typeof vi.fn>).mockClear());
  aosInit.mockClear();
  allowMotion();
});
afterEach(() => {
  cleanup();
  // @ts-expect-error jsdom has no matchMedia; remove the stub
  delete window.matchMedia;
});

const banner = (id: string): Banner =>
  ({
    id,
    title: { en: `Banner ${id}`, ar: `لافتة ${id}` },
    subtitle: null,
    imageDesktop: { url: `https://cdn.test/${id}.jpg`, alt: { en: "a", ar: "أ" } },
    ctaLabel: { en: "Shop", ar: "تسوق" },
    ctaHref: "/shop",
  }) as unknown as Banner;

describe.each(["en", "ar"] as const)("UI-01 · home redesign (%s)", (locale) => {
  const m = messages[locale];

  it(`UI-01 · the hero CTA is a gold button (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1")]} />);
    const cta = screen.getByRole("link", { name: /Shop|تسوق/ });
    expect(cta.className).toContain("bg-gold");
    expect(cta.className).toContain("text-gold-foreground");
  });

  it(`UI-01 · hero: slow zoom starts after mount and the text stagger mirrors in RTL (${locale})`, async () => {
    wrap(locale, <Hero banners={[banner("1"), banner("2")]} />);
    await waitFor(() => expect(gsapMock.fromTo).toHaveBeenCalled());
    const [, from, to] = gsapMock.fromTo.mock.calls[0]!;
    expect(from).toEqual({ scale: 1 });
    expect(to).toMatchObject({ scale: 1.08, ease: "none" });
    const stagger = gsapMock.from.mock.calls[0]![1] as { x: number };
    expect(Math.sign(stagger.x)).toBe(locale === "ar" ? -1 : 1);
  });

  it(`UI-01 · hero: no GSAP at all under reduced motion (${locale})`, async () => {
    reduce();
    wrap(locale, <Hero banners={[banner("1")]} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(gsapMock.fromTo).not.toHaveBeenCalled();
    expect(gsapMock.from).not.toHaveBeenCalled();
  });

  it(`UI-01 · section reveals run once per element and move vertically only (no RTL overflow) (${locale})`, async () => {
    wrap(
      locale,
      <>
        <div data-reveal />
        <div data-reveal />
        <HomeReveals />
      </>,
    );
    await waitFor(() => expect(gsapMock.from).toHaveBeenCalledTimes(2));
    const vars = gsapMock.from.mock.calls[0]![1] as { x?: number; y: number; opacity: number; scrollTrigger: { once: boolean } };
    expect(vars.x).toBeUndefined();
    expect(vars.y).toBeGreaterThan(0);
    expect(vars.scrollTrigger.once).toBe(true);
  });

  it(`UI-01 · section reveals are skipped under reduced motion (${locale})`, async () => {
    reduce();
    wrap(locale, <><div data-reveal /><HomeReveals /></>);
    await new Promise((r) => setTimeout(r, 30));
    expect(gsapMock.from).not.toHaveBeenCalled();
  });

  it(`UI-01 · every home section, How resale works and the contact strip carry the reveal marker (${locale})`, () => {
    const sections: HomeSection[] = [
      { id: "s1", type: "FEATURED_PRODUCTS", title: { en: "F", ar: "ف" }, products: [{ id: "p1", slug: "p-1", title: { en: "A", ar: "أ" }, type: "NEW", condition: "NEW", price: 100, stock: 1, images: [] }] } as unknown as HomeSection,
    ];
    wrap(locale, <><HomeSections sections={sections} locale={locale} /><ContactStrip settings={{ contactEmail: "a@b.co" }} /></>);
    expect(screen.getByTestId("home-section-FEATURED_PRODUCTS").hasAttribute("data-reveal")).toBe(true);
    expect(screen.getByTestId("how-resale").hasAttribute("data-reveal")).toBe(true);
    expect(screen.getByTestId("contact-strip").hasAttribute("data-reveal")).toBe(true);
  });

  it(`UI-01 · a category without an image gets the emerald placeholder tile (${locale})`, () => {
    const sections = [
      { id: "c1", type: "CATEGORY_GRID", title: { en: "Cats", ar: "فئات" }, categories: [{ id: "k1", slug: "sofas", name: { en: "Sofas", ar: "أرائك" }, image: null }] },
    ] as unknown as HomeSection[];
    wrap(locale, <HomeSections sections={sections} locale={locale} />);
    expect(screen.getByTestId("image-placeholder").getAttribute("aria-label")).toBe(m.home.brand);
  });

  it(`UI-01 · contact strip: email, phone (left-to-right) and WhatsApp, with no newsletter form (${locale})`, () => {
    wrap(
      locale,
      <ContactStrip
        settings={{ contactEmail: "hello@furnixa.sa", contactPhone: "+966551234567", socials: { whatsapp: "https://wa.me/966551234567" } }}
      />,
    );
    expect(screen.getByTestId("contact-email").getAttribute("href")).toBe("mailto:hello@furnixa.sa");
    expect(screen.getByTestId("contact-phone").getAttribute("href")).toBe("tel:+966551234567");
    expect(screen.getByTestId("contact-phone").querySelector("[dir=ltr]")).not.toBeNull();
    expect(screen.getByTestId("contact-whatsapp").getAttribute("href")).toBe("https://wa.me/966551234567");
    expect(screen.getByTestId("contact-whatsapp").getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(m.home.contact.title)).toBeTruthy();
    expect(document.querySelector("form, input")).toBeNull();
  });

  it(`UI-01 · contact strip: unsafe WhatsApp links are dropped and an empty strip is hidden (${locale})`, () => {
    const { unmount } = wrap(locale, <ContactStrip settings={{ socials: { whatsapp: "javascript:alert(1)" } }} />);
    expect(screen.queryByTestId("contact-strip")).toBeNull();
    unmount();
    wrap(locale, <ContactStrip settings={{ contactEmail: "a@b.co", socials: { whatsapp: "http://wa.me/1" } }} />);
    expect(screen.queryByTestId("contact-whatsapp")).toBeNull();
    expect(screen.getByTestId("contact-email")).toBeTruthy();
  });

  it(`UI-01 · page transition is enter-only, transform-only and never starts with opacity 0 (${locale})`, () => {
    wrap(locale, <Template><p>page</p></Template>);
    const el = screen.getByTestId("page-transition");
    expect(el.style.opacity).toBe("");
    expect(screen.getByText("page")).toBeTruthy();
  });

  it(`UI-01 · AOS: only blocks below the first screen are marked, and only after mount (${locale})`, async () => {
    const again = wrap(
      locale,
      <>
        <div data-aos-group>
          <p data-testid="top2">top</p>
          <p data-testid="low2" ref={(el) => { if (el) el.getBoundingClientRect = () => ({ top: 5000 }) as DOMRect; }}>low</p>
        </div>
        <AosInit />
      </>,
    );
    await waitFor(() => expect(aosInit).toHaveBeenCalledWith(expect.objectContaining({ once: true, offset: 80, duration: 600 })));
    expect(again.container.querySelector('[data-testid="low2"]')!.getAttribute("data-aos")).toBe("fade-up");
    expect(again.container.querySelector('[data-testid="top2"]')!.hasAttribute("data-aos")).toBe(false);
  });

  it(`UI-01 · AOS is not started under reduced motion (${locale})`, async () => {
    reduce();
    wrap(locale, <><div data-aos-group><p>x</p></div><AosInit /></>);
    await new Promise((r) => setTimeout(r, 30));
    expect(aosInit).not.toHaveBeenCalled();
  });
});
