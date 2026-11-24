import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import ar from "../locales/ar.json";
import en from "../locales/en.json";

// T-079 / ADR-015 Q-3: the admin follows the v2 identity, calm: Readex Pro headings, IBM Plex body,
// no arch in the chrome, no hero motion, no scroll reveals.

const SRC = path.resolve(import.meta.dirname, "..");
const CSS = readFileSync(path.join(SRC, "index.css"), "utf8");
const PKG = JSON.parse(readFileSync(path.resolve(SRC, "..", "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};

const files = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "test" ? [] : files(path.join(d, e.name))) : /\.(tsx?|css)$/.test(e.name) ? [path.join(d, e.name)] : [],
  );

describe("UI-01 · admin fonts (v2)", () => {
  it("UI-01 · Readex Pro, IBM Plex Sans and IBM Plex Sans Arabic are self-hosted through the font packages", () => {
    for (const dep of ["@fontsource-variable/readex-pro", "@fontsource-variable/ibm-plex-sans", "@fontsource/ibm-plex-sans-arabic"]) {
      expect(PKG.dependencies[dep], dep).toBeDefined();
    }
    expect(CSS).toContain('@import "@fontsource-variable/readex-pro/index.css"');
    expect(CSS).toContain('@import "@fontsource-variable/ibm-plex-sans/index.css"');
    expect(CSS).toMatch(/@import "@fontsource\/ibm-plex-sans-arabic\/400\.css"/);
  });

  it("UI-01 · headings use Readex Pro in both scripts; body is Plex Sans, and Plex Sans Arabic first in Arabic", () => {
    expect(CSS).toMatch(/--font-display:\s*"Readex Pro Variable"/);
    expect(CSS).toMatch(/--font-sans:\s*"IBM Plex Sans Variable",\s*"IBM Plex Sans Arabic"/);
    const ar_ = /html\[lang="ar"\]\s*\{[^}]*--font-sans:\s*"IBM Plex Sans Arabic",\s*"IBM Plex Sans Variable"/.exec(CSS);
    expect(ar_).not.toBeNull();
  });

  it("UI-01 · no v1 font variable (Fraunces, Manrope, Noto Kufi) is referenced any more", () => {
    for (const f of files(SRC)) expect(readFileSync(f, "utf8"), f).not.toMatch(/fraunces|manrope|noto-kufi|font-plex-arabic/i);
  });

  it("UI-01 · the heading rules sit in the base layer so utilities can override them; Arabic is never tracked", () => {
    expect(CSS).toMatch(/@layer base\s*\{[\s\S]*h1,[\s\S]*font-weight:\s*600/);
    expect(CSS).toMatch(/html\[lang="ar"\] :is\(h1, h2, h3, h4\)\s*\{[^}]*letter-spacing:\s*0/);
    expect(CSS).toMatch(/html\[lang="en"\] :is\(h1, h2, h3, h4\)\s*\{[^}]*letter-spacing:\s*-0\.02em/);
  });

  it("UI-01 · the new font packages add no install scripts and no lifecycle hooks to package.json", () => {
    for (const k of Object.keys(PKG.scripts)) expect(k).not.toMatch(/^(pre|post)?install$|^prepare$|^init$/);
  });
});

describe("UI-01 · admin stays calm (ADR-015 Q-3)", () => {
  it("UI-01 · radii above 10 px and the v1 24 px radius are gone; one floating shadow token", () => {
    expect(CSS).toMatch(/--radius-lg:\s*10px/);
    expect(CSS).toMatch(/--radius-xl:\s*10px/);
    expect(CSS).toMatch(/--shadow-soft:\s*0 10px 30px -12px rgb\(20 32 29/);
  });

  it("UI-04 · the arch is gone from the admin too (ADR-018); no GSAP, AOS or scroll reveals", () => {
    const archUsers = files(SRC).filter((f) => /clipPath|clip-path|arch-crop|ARCH_PATH/.test(readFileSync(f, "utf8")));
    expect(archUsers.map((f) => path.relative(SRC, f).replaceAll("\\", "/")).sort()).toEqual([]);
    for (const f of files(SRC)) expect(readFileSync(f, "utf8"), f).not.toMatch(/from "gsap|from "aos|data-aos|data-reveal|\.shimmer/);
    expect(PKG.dependencies).not.toHaveProperty("gsap");
    expect(PKG.dependencies).not.toHaveProperty("aos");
  });

  it("UI-04 · the banner image hint and focal-point strings exist in both languages and mention the focal point", () => {
    for (const k of ["imageHint", "cropDesktop", "cropMobile"] as const) {
      expect(en.banners.form[k]).toBeTruthy();
      expect(ar.banners.form[k]).toBeTruthy();
    }
    for (const k of ["title", "hint", "reset"] as const) {
      expect(en.banners.focal[k]).toBeTruthy();
      expect(ar.banners.focal[k]).toBeTruthy();
    }
    expect(en.banners.form.imageHint).toMatch(/focal point/i);
    expect(JSON.stringify(en.banners)).not.toMatch(/arch/i);
  });
});
