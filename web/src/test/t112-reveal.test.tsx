// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Reveal, RevealGroup, RevealItem, RevealLine, RevealNoScript, staggerSecondsFor } from "@/components/motion/reveal";

/**
 * T-112 / UI-05 (ADR-019): the shared reveal primitive.
 *
 * What is asserted here is the contract that holds whatever the animation engine does: the first-paint state, the
 * two static branches (reduced motion, no IntersectionObserver), that children are always in the DOM, and that
 * nothing ever moves horizontally. Whether the reveal actually plays, plays only once, and leaves the page complete
 * with JavaScript off is a real-browser question and belongs to T-115's Playwright spec - jsdom runs no animation.
 */

/** An observer that exists but never reports anything, so a reveal stays at its first-paint state. */
class SilentObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

/** prefers-reduced-motion, as `useReducedMotion` reads it. */
function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", SilentObserver);
  stubMatchMedia(false);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UI-05 · the stagger window is capped", () => {
  it("UI-05 · a single child does not stagger", () => {
    expect(staggerSecondsFor(0)).toBe(0);
    expect(staggerSecondsFor(1)).toBe(0);
  });

  it("UI-05 · small groups use the full 70 ms, long rows compress, and nothing leaves the approved 60-80 ms band", () => {
    expect(staggerSecondsFor(2)).toBeCloseTo(0.07, 5);
    expect(staggerSecondsFor(5)).toBeCloseTo(0.07, 5); // 4 gaps x 70 ms = 280 ms, inside the window
    expect(staggerSecondsFor(6)).toBeCloseTo(0.07, 5); // 5 gaps x 70 ms = 350 ms, exactly the window
    expect(staggerSecondsFor(8)).toBeCloseTo(0.06, 5); // 350 / 7 would be 50 ms, so the 60 ms floor holds
    for (const n of [2, 3, 4, 5, 6, 8, 12, 24]) {
      const stagger = staggerSecondsFor(n);
      expect(stagger).toBeGreaterThanOrEqual(0.06 - 1e-9); // the approved band's floor
      expect(stagger).toBeLessThanOrEqual(0.08 + 1e-9); // and its ceiling
    }
  });
});

describe.each(["en", "ar"] as const)("UI-05 · reveal contract (%s)", (locale) => {
  const dir = locale === "ar" ? "rtl" : "ltr";
  // The primitive reads `useMotionPrefs`, which reads the locale, so it needs the intl provider the storefront gives it.
  const view = (ui: React.ReactNode) =>
    render(
      <NextIntlClientProvider locale={locale} messages={{}}>
        <div dir={dir}>{ui}</div>
      </NextIntlClientProvider>,
    );

  it(`UI-05 · a block starts hidden by 24 px and is marked as a reveal (${locale})`, () => {
    view(<Reveal>Sofas and wardrobes</Reveal>);
    const block = screen.getByText("Sofas and wardrobes");
    expect(block.dataset.motion).toBe("reveal");
    expect(block.style.opacity).toBe("0");
    expect(block.style.transform).toContain("24px");
  });

  it(`UI-05 · nothing moves horizontally, in either writing direction (${locale})`, () => {
    view(
      <RevealGroup as="ul">
        <RevealItem as="li">Dining table</RevealItem>
        <RevealItem as="li">Bed frame</RevealItem>
      </RevealGroup>,
    );
    for (const name of ["Dining table", "Bed frame"]) {
      expect(screen.getByText(name).style.transform ?? "").not.toMatch(/translateX|translate3d\(\s*[^0]/);
    }
  });

  it(`UI-05 · a group keeps valid markup: every item is a direct child of the list (${locale})`, () => {
    const { container } = view(
      <RevealGroup as="ul" className="grid">
        <RevealItem as="li">Armchair</RevealItem>
        <RevealItem as="li">Bookcase</RevealItem>
        <RevealItem as="li">Rug</RevealItem>
      </RevealGroup>,
    );
    const list = container.querySelector("ul");
    expect(list).not.toBeNull();
    expect(list!.className).toContain("grid");
    expect(list!.dataset.motion).toBe("reveal-group");
    // The delay providers render no element, so the list has exactly its three <li> children and the grid is intact.
    expect([...list!.children].map((c) => c.tagName)).toEqual(["LI", "LI", "LI"]);
    expect([...list!.children].every((c) => (c as HTMLElement).dataset.motion === "reveal-item")).toBe(true);
  });

  it(`UI-05 · reduced motion renders the final state, not a faster animation (${locale})`, () => {
    stubMatchMedia(true);
    view(
      <RevealGroup as="ul">
        <RevealItem as="li">Wardrobe</RevealItem>
      </RevealGroup>,
    );
    const item = screen.getByText("Wardrobe");
    expect(item.dataset.motion).toBe("static");
    expect(item.style.opacity).toBe("");
    expect(item.style.transform).toBe("");
    expect(item.tagName).toBe("LI");
  });

  it(`UI-05 · without IntersectionObserver the block settles visible instead of staying hidden (${locale})`, () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    view(<Reveal>Mattress</Reveal>);
    const block = screen.getByText("Mattress");
    expect(block.dataset.motion).toBe("static");
    expect(block.style.opacity).toBe("");
    expect(block.style.transform).toBe("");
  });

  it(`UI-05 · the content is in the DOM in every branch, never hidden from assistive technology (${locale})`, () => {
    for (const reduce of [false, true]) {
      cleanup();
      stubMatchMedia(reduce);
      view(<Reveal as="section">Pre-owned, half the price</Reveal>);
      const block = screen.getByText("Pre-owned, half the price");
      expect(block.style.display).not.toBe("none");
      expect(block.style.visibility).not.toBe("hidden");
      expect(block).toBeTruthy();
    }
  });

  it(`UI-05 · the champagne hairline draws from the inline start and is decorative only (${locale})`, () => {
    const { container } = view(<RevealLine />);
    const line = container.querySelector("span");
    expect(line).not.toBeNull();
    expect(line!.getAttribute("aria-hidden")).toBe("true");
    expect(line!.className).toContain("origin-left"); // LTR: grows to the right
    expect(line!.className).toContain("rtl:origin-right"); // RTL: grows to the left
    expect(line!.className).toContain("bg-champagne"); // decorative surface, never a text colour
    expect(line!.dataset.motion).toBe("reveal-line");
    expect(line!.style.transform).toContain("scaleX(0)");
  });

});

/**
 * The no-script fallback is asserted against the SERVER markup on purpose. React's client renderer drops the
 * children of <noscript> (they are meaningless once scripting is on), so a jsdom render shows an empty element and
 * would prove nothing. The server HTML is also the only thing a visitor without JavaScript ever receives, so this
 * is the path that matters. T-115's Playwright spec covers the same ground in a real browser with JS disabled.
 */
describe("UI-05 · the no-script fallback forces the final state", () => {
  it("UI-05 · the server sends a <noscript> override for every reveal state", () => {
    const html = renderToStaticMarkup(<RevealNoScript />);
    expect(html).toContain("<noscript>");
    expect(html).toContain('[data-motion="reveal"]');
    expect(html).toContain('[data-motion="reveal-item"]');
    expect(html).toContain('[data-motion="reveal-line"]');
    expect(html).toContain("opacity:1!important");
    expect(html).toContain("transform:none!important");
  });

  it("UI-05 · the home page sends that override, so nothing on it stays hidden without JavaScript", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const page = readFileSync(path.resolve(import.meta.dirname, "../app/[locale]/page.tsx"), "utf8");
    expect(page).toMatch(/RevealNoScript/);
  });
});
