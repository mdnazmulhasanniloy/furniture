// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/shop",
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import { ShopFrame } from "@/components/shop/shop-controls";
import { ProductGrid } from "@/components/shop/shop-results";
import { parseFilters } from "@/lib/shop";

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
afterEach(() => {
  cleanup();
  // @ts-expect-error jsdom has no matchMedia; remove the stub
  delete window.matchMedia;
});

describe.each(["en", "ar"] as const)("UI-04 · listing (%s)", (locale) => {
  it(`UI-04 · the filter sidebar is sticky on desktop and scrolls inside itself (${locale})`, () => {
    wrap(locale, <ShopFrame filters={parseFilters({})} categories={[]} locale={locale}><p>x</p></ShopFrame>);
    const aside = document.getElementById("shop-filters")!;
    expect(aside.className).toContain("lg:sticky");
    expect(aside.className).toContain("lg:top-24");
    expect(aside.className).toContain("lg:self-start");
    expect(aside.className).toContain("lg:overflow-y-auto");
    expect(aside.className).toContain("lg:max-h-[calc(100svh-7rem)]");
  });

  it(`UI-04 · on mobile the filters are a bottom sheet with an 8 px top corner, sticky again from desktop (${locale})`, () => {
    wrap(locale, <ShopFrame filters={parseFilters({})} categories={[]} locale={locale}><p>x</p></ShopFrame>);
    fireEvent.click(screen.getByRole("button", { name: messages[locale].shop.filters }));
    const sheet = screen.getByRole("dialog");
    expect(sheet.className).toContain("bottom-0");
    expect(sheet.className).toContain("rounded-t-lg");
    expect(sheet.className).toContain("lg:sticky");
    expect(screen.getByTestId("filters-backdrop")).toBeTruthy();
  });

  it(`UI-04 · the empty state is a blush panel with a serif title (${locale})`, () => {
    wrap(locale, <ProductGrid items={[]} locale={locale} filters={parseFilters({})} />);
    const title = screen.getByText(messages[locale].shop.empty.title);
    expect(title.className).toContain("font-display");
    expect(title.parentElement!.className).toContain("bg-blush");
    expect(title.parentElement!.className).toContain("rounded-lg");
  });
});
