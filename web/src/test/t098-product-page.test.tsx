import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// UI-04 product page: source-level checks of the layout classes (the behaviour tests live in the PROD-02 suites).
const read = (f: string) => readFileSync(path.resolve(import.meta.dirname, "..", f), "utf8");

describe("UI-04 · product page layout", () => {
  const detail = read("components/product/product-detail.tsx");
  it("UI-04 · the page uses the wide container and a large gallery column", () => {
    expect(detail).toContain('<main className="container-wide');
    expect(detail).toMatch(/lg:grid-cols-\[minmax\(0,1\.3fr\)_minmax\(0,1fr\)\]/);
    expect(read("app/[locale]/shop/[slug]/page.tsx")).toContain("container-wide");
  });
  it("UI-04 · the buy box stays sticky on desktop and the mobile bar stays fixed", () => {
    expect(detail).toMatch(/data-testid="buy-box" className="[^"]*lg:sticky lg:top-24 lg:self-start/);
    expect(read("components/product/sticky-buy-bar.tsx")).toContain("fixed inset-x-0 bottom-0");
  });
  it("UI-04 · the delivery note is a blush panel, titles are body-face sizes", () => {
    expect(detail).toContain("bg-blush");
    expect(detail).toMatch(/<h1 className="text-3xl md:text-4xl">/);
  });
  it("UI-04 · gallery thumbnails are 96 px on desktop with 4 px corners and the main photo has 8 px corners", () => {
    const g = read("components/product/gallery.tsx");
    expect(g).toContain("md:size-24");
    expect(g).toContain("rounded-sm");
    expect(g).toContain("rounded-lg");
  });
});
