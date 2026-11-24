// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import ar from "../../messages/ar.json";
import { KernedText, kernPairs } from "@/components/kerned-text";

afterEach(cleanup);
const wrap = (locale: "en" | "ar", text: string) =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : ar}>
      <h1>
        <KernedText>{text}</KernedText>
      </h1>
    </NextIntlClientProvider>,
  );

describe("UI-04 · Bodoni pair kerning (review item 6)", () => {
  it("UI-04 · a capital W/V/Y/T before a lowercase letter is tightened, nothing else", () => {
    expect(kernPairs("Warm Wave").filter((p) => typeof p !== "string")).toHaveLength(2);
    expect(kernPairs("when WOW")).toEqual(["when WOW"]); // lowercase w and W before a capital are untouched
    expect(kernPairs("Pay Very Tall").filter((p) => typeof p !== "string").map((p) => (p as { letter: string }).letter)).toEqual(["V", "T"]);
  });

  it("UI-04 · English headings get a negative inline-end margin on those letters and the text stays intact", () => {
    const { container } = wrap("en", "Warm living rooms");
    const w = container.querySelector("[data-kern=W]") as HTMLElement;
    expect(w.style.marginInlineEnd).toBe("-0.07em");
    expect(container.querySelector("h1")!.textContent).toBe("Warm living rooms");
  });

  it("UI-04 · Arabic headings are never touched", () => {
    const { container } = wrap("ar", "Warm غرف");
    expect(container.querySelector("[data-kern]")).toBeNull();
    expect(container.querySelector("h1")!.textContent).toBe("Warm غرف");
  });

  it("UI-04 · the hero headline enables kerning and slight negative tracking in Latin, none in Arabic", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "..", "app", "globals.css"), "utf8");
    const hero = css.match(/\.type-hero\s*\{([^}]*)\}/)![1]!;
    expect(hero).toContain("font-kerning: normal");
    expect(hero).toMatch(/letter-spacing:\s*-0\.0[1-3]\d?em/);
    expect(css).toMatch(/html\[lang="ar"\] \.type-hero\s*\{[^}]*letter-spacing:\s*0/);
  });
});
