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

import { ContactStrip } from "@/components/home/contact-strip";
import { Hero } from "@/components/home/hero";
import { HomeSections } from "@/components/home/home-sections";
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

  it(`UI-01 · the hero CTA is an emerald button (no shimmer) (${locale})`, () => {
    wrap(locale, <Hero banners={[banner("1")]} />);
    const cta = screen.getByRole("link", { name: /Shop|تسوق/ });
    expect(cta.className).toContain("bg-primary");
    expect(cta.className).not.toContain("shimmer");
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
});

describe("UI-01 · removed v1 motion (ADR-015)", () => {
  it("UI-01 · no AOS, scroll reveals, page transition, marquee or shimmer remain in the source", async () => {
    const { existsSync, readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const src = path.resolve(import.meta.dirname, "..");
    for (const gone of ["components/aos-init.tsx", "components/home/home-reveals.tsx", "app/[locale]/template.tsx"]) {
      expect(existsSync(path.join(src, gone)), gone).toBe(false);
    }
    const files = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (e.name === "test" ? [] : files(path.join(d, e.name))) : /\.(tsx?|css)$/.test(e.name) ? [path.join(d, e.name)] : [],
      );
    const offenders = files(src).filter((f) => /from "aos"|data-aos|data-reveal|animate-marquee|\.shimmer|pattern-emerald/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
