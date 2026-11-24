import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// UI-02 / SRC-008.5: every string literal in src/ that names a colour token class is checked against
// the REAL globals.css values (light; the storefront has no dark theme). Mirrors the admin scan.

const SRC = path.resolve(import.meta.dirname, "..");
const CSS = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");
const root = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("}", CSS.indexOf(":root {")));
const T: Record<string, string> = {};
for (const m of root.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) T[m[1]!] = m[2]!;
type RGB = [number, number, number];
const rgb = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const lum = (c: RGB) => {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const blend = (f: RGB, b: RGB, al: number): RGB => f.map((v, i) => Math.round(v * al + b[i]! * (1 - al))) as RGB;
const SURFACES = ["background", "card", "muted", "blush"];
const tok = (n: string) => rgb(T[n]!);

function ratiosOf(classes: string) {
  let bg: { n: string; al: number } | null = null;
  let fg: string | null = null;
  for (const c of classes.split(/\s+/)) {
    if (c.includes(":")) continue;
    const b = /^bg-([a-z-]+?)(?:\/(\d+))?$/.exec(c);
    if (b && b[1]! in T) bg = { n: b[1]!, al: b[2] ? Number(b[2]) / 100 : 1 };
    const t = /^text-([a-z-]+)$/.exec(c);
    if (t && t[1]! in T) fg = t[1]!;
  }
  if (!fg) return null;
  if (!bg) {
    if (["primary-foreground", "secondary-foreground", "gold-foreground"].includes(fg)) return null;
    return SURFACES.map((s) => ({ label: `${fg} on ${s}`, value: ratio(tok(fg!), tok(s)) }));
  }
  return SURFACES.map((s) => {
    const fill = bg!.al < 1 ? blend(tok(bg!.n), tok(s), bg!.al) : tok(bg!.n);
    return { label: `${fg} on ${bg!.n}/${bg!.al} over ${s}`, value: ratio(tok(fg!), fill) };
  });
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "test" ? [] : files(f);
    return /\.(ts|tsx)$/.test(e.name) ? [f] : [];
  });
}
const LITERALS: { file: string; text: string }[] = [];
for (const f of files(SRC)) {
  for (const m of readFileSync(f, "utf8").matchAll(/["'`]([^"'`\n]*\b(?:bg|text)-[a-z][^"'`\n]*)["'`]/g)) {


    if (/\b(?:bg|text)-(?:background|foreground|card|muted|primary|secondary|gold|champagne|blush|price|destructive|success|warning)/.test(m[1]!)) {
      LITERALS.push({ file: path.relative(SRC, f), text: m[1]! });
    }
  }
}

describe("UI-02 · AA contrast over every colour call site in src/ (storefront, light)", () => {
  it("UI-02 · every badge, chip and text colour used in src/ is at least 4.5:1", () => {
    expect(LITERALS.length).toBeGreaterThan(40);
    const failures: string[] = [];
    let checked = 0;
    for (const { file, text } of LITERALS) {
      const r = ratiosOf(text);
      if (!r) continue;
      checked++;
      for (const x of r) if (x.value < 4.5) failures.push(file + ": " + text + " -> " + x.label + " = " + x.value.toFixed(2));
    }
    expect(checked).toBeGreaterThan(30);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("UI-02 · no text-white, raw warning or gold text, or accent classes in src/", () => {
    const bad = LITERALS.filter(({ text }) =>
      text.split(/\s+/).some((c) => /^(?:text-white|text-warning|text-gold|text-champagne|text-accent|bg-accent)$/.test(c)),
    );
    expect(bad.map((b) => b.file + ": " + b.text)).toEqual([]);
  });
});
