// @vitest-environment jsdom
// QA 2026-11-24 item 6: Min 3000 / Max 1000 must say so and not navigate; a negative or non-numeric price
// cannot be typed at all. The API refuses the same range with a 422 (tests/products/public-list.test.ts).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const push = vi.hoisted(() => vi.fn());
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/shop",
}));

import { ShopFrame } from "@/components/shop/shop-controls";
import { parseFilters } from "@/lib/shop";

const messages = { en, ar } as const;
const filters = parseFilters({});

const view = (locale: "en" | "ar") =>
  render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <ShopFrame filters={filters} categories={[]} locale={locale}>
        <p>results</p>
      </ShopFrame>
    </NextIntlClientProvider>,
  );

beforeEach(() => push.mockClear());
afterEach(cleanup);

for (const locale of ["en", "ar"] as const) {
  describe(`QA-6 · price filter (${locale})`, () => {
    const m = messages[locale];
    const fields = () => ({
      min: screen.getAllByLabelText(m.shop.minPrice)[0] as HTMLInputElement,
      max: screen.getAllByLabelText(m.shop.maxPrice)[0] as HTMLInputElement,
      apply: screen.getAllByRole("button", { name: m.shop.apply })[0],
    });

    it("min greater than max shows the message, marks both fields invalid and blocks Apply", () => {
      view(locale);
      const { min, max, apply } = fields();
      fireEvent.change(min, { target: { value: "3000" } });
      fireEvent.change(max, { target: { value: "1000" } });
      const error = screen.getAllByTestId("price-range-error")[0];
      expect(error.textContent).toBe(m.shop.priceRangeError);
      expect(error.getAttribute("role")).toBe("alert");
      expect(min.getAttribute("aria-invalid")).toBe("true");
      expect(max.getAttribute("aria-invalid")).toBe("true");
      fireEvent.click(apply);
      expect(push).not.toHaveBeenCalled(); // no "No products found" page
    });

    it("the message clears and Apply works once the range is the right way round", () => {
      view(locale);
      const { min, max, apply } = fields();
      fireEvent.change(min, { target: { value: "3000" } });
      fireEvent.change(max, { target: { value: "1000" } });
      expect(screen.queryAllByTestId("price-range-error")).not.toHaveLength(0);
      fireEvent.change(max, { target: { value: "4000" } });
      expect(screen.queryAllByTestId("price-range-error")).toHaveLength(0);
      fireEvent.click(apply);
      expect(push).toHaveBeenCalledTimes(1);
      const href = String(push.mock.calls[0][0]);
      expect(href).toContain("minPrice=300000"); // riyals to halalas
      expect(href).toContain("maxPrice=400000");
    });

    it("equal bounds are allowed, and one bound alone is allowed", () => {
      view(locale);
      const { min, max, apply } = fields();
      fireEvent.change(min, { target: { value: "500" } });
      fireEvent.change(max, { target: { value: "500" } });
      expect(screen.queryAllByTestId("price-range-error")).toHaveLength(0);
      fireEvent.click(apply);
      fireEvent.change(max, { target: { value: "" } });
      expect(screen.queryAllByTestId("price-range-error")).toHaveLength(0);
      fireEvent.click(apply);
      expect(push).toHaveBeenCalledTimes(2);
    });

    it("a minus sign, letters and a second decimal point cannot be typed", () => {
      view(locale);
      const { min } = fields();
      fireEvent.change(min, { target: { value: "-500" } });
      expect(min.value).toBe("500");
      fireEvent.change(min, { target: { value: "12abc" } });
      expect(min.value).toBe("12");
      fireEvent.change(min, { target: { value: "12.5.7" } });
      expect(min.value).toBe("12.57");
      fireEvent.change(min, { target: { value: "" } });
      expect(min.value).toBe("");
    });
  });
}
