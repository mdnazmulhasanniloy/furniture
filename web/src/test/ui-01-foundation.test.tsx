// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

import { ImagePlaceholder, Wordmark } from "@/components/brand";
import { Price } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { useMotionPrefs } from "@/lib/use-motion-prefs";

const locales = { en, ar } as const;
afterEach(() => {
  cleanup();
  // @ts-expect-error jsdom has no matchMedia; remove the stub again
  delete window.matchMedia;
});

function Probe() {
  const p = useMotionPrefs();
  return <p data-testid="p">{JSON.stringify(p)}</p>;
}
function Brand() {
  const t = useTranslations("home");
  return <ImagePlaceholder name={t("brand")} />;
}
const wrap = (locale: "en" | "ar", ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale={locale} messages={locales[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );

describe.each(["en", "ar"] as const)("UI-01 · foundation (%s)", (locale) => {
  it(`UI-01 · the motion hook mirrors horizontal offsets in RTL (${locale})`, () => {
    wrap(locale, <Probe />);
    const p = JSON.parse(screen.getByTestId("p").textContent!);
    expect(p.rtl).toBe(locale === "ar");
    expect(p.dir).toBe(locale === "ar" ? -1 : 1);
    expect(p.reduced).toBe(false);
  });

  it(`UI-01 · the motion hook reports prefers-reduced-motion (${locale})`, () => {
    window.matchMedia = ((q: string) =>
      ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
    wrap(locale, <Probe />);
    expect(JSON.parse(screen.getByTestId("p").textContent!).reduced).toBe(true);
  });

  it(`UI-01 · the placeholder is a flat sand block with the localized wordmark and a gold underline (${locale})`, () => {
    wrap(locale, <Brand />);
    const img = screen.getByTestId("image-placeholder");
    expect(img.getAttribute("aria-label")).toBe(locale === "ar" ? "فرنيكسا" : "Furnixa");
    expect(img.className).toContain("bg-muted");
    expect(img.className).not.toMatch(/gradient|pattern/);
    expect(screen.getByTestId("wordmark").className).toContain("border-gold");
  });

  it(`UI-01 · the Price component uses the price token (${locale})`, () => {
    const { container } = wrap(locale, <Price halalas={125000} locale={locale} />);
    expect(container.querySelector("bdi")?.className).toContain("text-price");
  });

  it(`UI-01 · badges carry the v2 colour pairs (${locale})`, () => {
    wrap(
      locale,
      <>
        <Badge variant="new">a</Badge>
        <Badge variant="preowned">b</Badge>
        <Badge variant="featured">c</Badge>
      </>,
    );
    expect(screen.getByText("a").className).toContain("bg-primary");
    expect(screen.getByText("b").className).toContain("text-secondary-foreground");
    expect(screen.getByText("c").className).toContain("border-primary");
  });
});

describe("UI-01 · wordmark is plain text", () => {
  it("UI-01 · Wordmark renders its name", () => {
    render(<Wordmark name="Furnixa" />);
    expect(screen.getByText("Furnixa")).toBeTruthy();
  });
});

