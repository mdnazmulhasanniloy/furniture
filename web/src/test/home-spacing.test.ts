import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CR-011 review item 4: one vertical rhythm, no doubled paddings between home sections.
const SRC = path.resolve(import.meta.dirname, "..");
const css = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");
const read = (f: string) => readFileSync(path.join(SRC, f), "utf8");

describe("UI-04 · one section spacing scale on the home page", () => {
  it("UI-04 · a plain band owns only its top padding, from one token (40 px mobile, 64 px desktop)", () => {
    expect(css).toMatch(/--band-gap:\s*40px/);
    expect(css).toMatch(/min-width:\s*1024px\)\s*\{\s*:root\s*\{\s*--band-gap:\s*64px/);
    expect(css).toMatch(/\.band\s*\{\s*padding-top:\s*var\(--band-gap\)/);
    const band = css.match(/\.band\s*\{([^}]*)\}/)![1]!;
    expect(band).not.toMatch(/padding-bottom|padding-block|margin-bottom/);
  });

  it("UI-04 · every home section uses the band classes, not its own py-* padding or a narrow container", () => {
    for (const f of ["components/home/home-sections.tsx", "components/home/shelf.tsx", "components/home/category-row.tsx", "components/home/how-resale.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\bpy-(?:12|16|20|24)\b|md:py-/);
      expect(src, f).not.toContain("max-w-7xl");
      expect(src, f).toMatch(/\bband(?:-fill)?\b/);
    }
    expect(read("app/[locale]/page.tsx")).toContain("band-end");
  });
});
