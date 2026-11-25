import { describe, expect, it } from "vitest";
import { halalasToSar, MAX_PRICE_HALALAS, parseSar, sarHalalas } from "@/lib/money";

/**
 * QA 2026-11-24 (A3) and B-031 (owner): every admin money input takes SAR with at most 2 decimals and
 * converts to integer halalas exactly - entering halalas invited 100x pricing mistakes. Parsing is
 * string/integer arithmetic, so none of these cases can drift by a float cent.
 */
describe("A3 · SAR amounts parse to exact halalas", () => {
  it("A3 · the amounts from the report", () => {
    expect(parseSar("150")).toEqual({ ok: true, halalas: 15000 });
    expect(parseSar("150.5")).toEqual({ ok: true, halalas: 15050 });
    expect(parseSar("150.50")).toEqual({ ok: true, halalas: 15050 });
    expect(parseSar("0.01")).toEqual({ ok: true, halalas: 1 });
    expect(parseSar("abc")).toEqual({ ok: false, reason: "invalid" });
    expect(parseSar("-150")).toEqual({ ok: false, reason: "negative" });
    expect(parseSar("-0.01")).toEqual({ ok: false, reason: "negative" });
    expect(parseSar("150.005")).toEqual({ ok: false, reason: "invalid" }); // 3 decimals: never rounded
  });

  it("A3 · 0.07 + 0.01 style amounts stay exact (no float cents)", () => {
    for (let cents = 0; cents <= 300; cents++) {
      const sar = halalasToSar(cents);
      expect(parseSar(sar), sar).toEqual({ ok: true, halalas: cents });
    }
    expect(parseSar("1250.50")).toEqual({ ok: true, halalas: 125050 });
    expect(parseSar("0.07")).toEqual({ ok: true, halalas: 7 });
    expect(parseSar("8.29")).toEqual({ ok: true, halalas: 829 });
  });

  it("A3 · group separators, Arabic-Indic digits and stray spaces are accepted (B-031)", () => {
    expect(parseSar("1,250.50")).toEqual({ ok: true, halalas: 125050 });
    expect(parseSar(" 1 250.50 ")).toEqual({ ok: true, halalas: 125050 });
    expect(parseSar("١٥٠")).toEqual({ ok: true, halalas: 15000 });
    expect(parseSar("١٥٠٫٥٠")).toEqual({ ok: true, halalas: 15050 }); // Arabic decimal mark
    expect(parseSar("۱۵۰.۵")).toEqual({ ok: true, halalas: 15050 }); // extended Arabic-Indic
    expect(parseSar("١٬٢٥٠٫٥٠")).toEqual({ ok: true, halalas: 125050 });
  });

  it("A3 · empty, partial and over-long amounts are invalid", () => {
    expect(parseSar("")).toEqual({ ok: false, reason: "invalid" });
    expect(parseSar("   ")).toEqual({ ok: false, reason: "invalid" });
    expect(parseSar(".5")).toEqual({ ok: false, reason: "invalid" });
    expect(parseSar("5.")).toEqual({ ok: false, reason: "invalid" });
    expect(parseSar("1e3")).toEqual({ ok: false, reason: "invalid" });
    expect(parseSar("12345678901")).toEqual({ ok: false, reason: "invalid" }); // 11 digits
  });

  it("A3 · halalasToSar round-trips and the price ceiling is 1,000,000 SAR", () => {
    expect(halalasToSar(15000)).toBe("150");
    expect(halalasToSar(15050)).toBe("150.50");
    expect(halalasToSar(1)).toBe("0.01");
    expect(halalasToSar(MAX_PRICE_HALALAS)).toBe("1000000");
    expect(sarHalalas("1000000")).toBe(MAX_PRICE_HALALAS);
    expect(() => sarHalalas("abc")).toThrow();
  });
});
