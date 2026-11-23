// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PhoneText, Price } from "@/components/format";
import { routing } from "@/i18n/routing";
import { formatDate, formatNumber, formatPercent, formatPrice } from "@/lib/format";
import {
  formatSaudiPhone,
  isValidSaudiPhone,
  normalizeSaudiPhone,
  SAUDI_PHONE_PATTERN,
} from "@/lib/format/phone";

const stripMarks = (s: string) => s.replace(/[\u200e\u200f\u061c\u00a0\s]/g, "");

describe("NFR-07 · SAR price formatting", () => {
  it("NFR-07 · whole riyals have no decimals (en and ar)", () => {
    expect(stripMarks(formatPrice(125000, "en"))).toBe("SAR1,250");
    expect(stripMarks(formatPrice(125000, "ar"))).toContain("1,250");
    expect(formatPrice(125000, "ar")).not.toMatch(/[.][0-9]/);
  });
  it("NFR-07 · fractional amounts show two decimals (en and ar)", () => {
    expect(stripMarks(formatPrice(1250, "en"))).toBe("SAR12.50");
    expect(stripMarks(formatPrice(1250, "ar"))).toContain("12.50");
  });
  it("NFR-07 · Western digits pinned in both locales; Gregorian dates", () => {
    expect(formatPrice(123456, "ar")).not.toMatch(/[٠-٩]/);
    expect(formatNumber(1234567, "ar")).toBe("1,234,567");
    expect(formatPercent(0.15, "ar")).not.toMatch(/[٠-٩]/);
    const d = new Date(Date.UTC(2026, 10, 24, 12, 0));
    expect(formatDate(d, "ar")).not.toMatch(/[٠-٩]/);
    expect(formatDate(d, "ar")).toContain("2026");
    expect(formatDate(d, "en")).toContain("2026");
    expect(formatDate(d, "en", true)).toMatch(/\d:\d\d/);
  });
  it("NFR-07 · Price wraps the amount in <bdi> (ar RTL and en LTR)", () => {
    for (const locale of ["ar", "en"] as const) {
      const { container } = render(<Price halalas={125000} locale={locale} />);
      expect(container.querySelector("bdi")?.textContent).toBe(formatPrice(125000, locale));
    }
  });
});

describe("I18N-01 · default locale", () => {
  it("I18N-01 · default locale is ar and locale prefix always applied", () => {
    expect(routing.defaultLocale).toBe("ar");
    expect(routing.locales).toEqual(["en", "ar"]);
    expect(routing.localePrefix).toBe("always");
  });
});

describe("NFR-06 · Saudi phone helper", () => {
  it("NFR-06 · pattern equals x-canonical-pattern in api-spec.yaml", () => {
    const spec = readFileSync(
      path.resolve(import.meta.dirname, "../../../project-docs/04-architecture/api-spec.yaml"),
      "utf8",
    );
    const m = spec.match(/x-canonical-pattern: '([^']+)'/);
    expect(m?.[1]).toBe(SAUDI_PHONE_PATTERN.source.replace("\+", "\+"));
  });
  it("NFR-06 · all accepted forms normalise to +9665XXXXXXXX", () => {
    for (const v of ["0512345678", "512345678", "+966512345678", "00966512345678", " 05-1234 5678 ", "٠٥١٢٣٤٥٦٧٨", "۰۵۱۲۳۴۵۶۷۸", "(051) 234.5678"]) {
      expect(normalizeSaudiPhone(v)).toBe("+966512345678");
    }
  });
  it("NFR-06 · rejects landlines, wrong length, letters, long input", () => {
    for (const v of ["0112345678", "051234567", "05123456789", "05123abc78", "", "+966 4 12345678", "0".repeat(26)]) {
      expect(isValidSaudiPhone(v)).toBe(false);
    }
    expect(normalizeSaudiPhone(undefined)).toBeNull();
  });
  it("NFR-06 · display format +966 5X XXX XXXX rendered dir=ltr (ar and en)", () => {
    expect(formatSaudiPhone("0512345678")).toBe("+966 51 234 5678");
    const { container } = render(<PhoneText value="0512345678" />);
    expect(container.querySelector("[dir=ltr]")?.textContent).toBe("+966 51 234 5678");
  });
});
