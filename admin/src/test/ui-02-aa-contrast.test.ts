import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buttonVariants } from "@/components/ui/button";

// UI-02 / SRC-008.5 / ADR-014: the AA gate reads the REAL token values from index.css (light and
// dark) and the REAL class strings used in src/ (every badge, status chip and text colour call
// site) plus the Button variants. A token or call-site edit that breaks AA fails here.

const SRC = path.resolve(import.meta.dirname, "..");
const CSS = readFileSync(path.join(SRC, "index.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!;
  return out;
}
const LIGHT = block(":root");
const THEMES = { light: LIGHT, dark: { ...LIGHT, ...block(".dark") } } as const;

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const lum = (c: RGB) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const blend = (fg: RGB, bg: RGB, alpha: number): RGB =>
  fg.map((v, i) => Math.round(v * alpha + bg[i]! * (1 - alpha))) as RGB;

const SURFACES = ["background", "card", "muted"] as const;
const AA = 4.5;
const fmt = (n: number) => n.toFixed(2);

function tok(theme: keyof typeof THEMES, name: string): RGB {
  const hex = THEMES[theme][name];
  if (!hex) throw new Error(`token --${name} missing in ${theme}`);
  return rgb(hex);
}

/** Fill and text token named by one class string; variants (hover:, focus:, ...) are ignored. */
function pairOf(classes: string, tokens: Record<string, string>) {
  let bg: { name: string; alpha: number } | null = null;
  let fg: string | null = null;
  for (const c of classes.split(/\s+/)) {
    if (c.includes(":")) continue;
    const b = /^bg-([a-z-]+?)(?:\/(\d+))?$/.exec(c);
    if (b && b[1]! in tokens) bg = { name: b[1]!, alpha: b[2] ? Number(b[2]) / 100 : 1 };
    const t = /^text-([a-z-]+)$/.exec(c);
    if (t && t[1]! in tokens) fg = t[1]!;
  }
  return { bg, fg };
}

/** Contrast values of one class string in a theme (fill composited over every surface when translucent). */
function ratiosOf(classes: string, theme: keyof typeof THEMES): { label: string; value: number }[] | null {
  const { bg, fg } = pairOf(classes, THEMES[theme]);
  if (!fg && !bg) return null;
  const text = fg ?? "foreground";
  if (!bg) {
    // Text colour alone: it sits on a page surface. Fill-bound foregrounds need their fill, skipped here.
    if (!fg || ["primary-foreground", "secondary-foreground", "gold-foreground"].includes(fg)) return null;
    return SURFACES.map((s) => ({ label: `${text} on ${s}`, value: ratio(tok(theme, text), tok(theme, s)) }));
  }
  if (!fg) return null; // fill without an explicit text colour inherits foreground; covered by the surface checks
  return SURFACES.map((s) => {
    const fill = bg.alpha < 1 ? blend(tok(theme, bg.name), tok(theme, s), bg.alpha) : tok(theme, bg.name);
    return { label: `${text} on ${bg.name}/${bg.alpha} over ${s}`, value: ratio(tok(theme, text), fill) };
  });
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "test" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

/** Every string literal in src/ that names a colour token class. */
const LITERALS: { file: string; text: string }[] = [];
for (const file of sources(SRC)) {
  const code = readFileSync(file, "utf8");
  for (const m of code.matchAll(/["'`]([^"'`\n]*\b(?:bg|text)-[a-z][^"'`\n]*)["'`]/g)) {
    if (/\b(?:bg|text)-(?:background|foreground|card|muted|primary|secondary|gold|price|destructive|success|warning)/.test(m[1]!)) {
      LITERALS.push({ file: path.relative(SRC, file), text: m[1]! });
    }
  }
}

describe.each(["light", "dark"] as const)("UI-02 · AA contrast on the admin design tokens (%s)", (theme) => {
  it(`UI-02 · the parser reads the brief's values (${theme})`, () => {
    const t = THEMES[theme];
    expect(Object.keys(t).length).toBeGreaterThan(18);
    expect(t.accent).toBeUndefined();
    if (theme === "light") {
      expect(t.primary).toBe("#0f4c45");
      expect(t.price).toBe("#86672a");
    } else {
      expect(t.background).toBe("#0e1513");
      expect(t.primary).toBe("#4fb3a3");
      expect(t.gold).toBe("#d9b865");
      expect(t.border).toBe("#24302d");
    }
  });

  it.each(["foreground", "muted-foreground"])(`UI-02 · %s is at least 4.5:1 on background, card and muted (${theme})`, (name) => {
    for (const s of SURFACES) {
      const r = ratio(tok(theme, name), tok(theme, s));
      expect(r, `${name} on ${s} = ${fmt(r)}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it(`UI-02 · the price colour is at least 4.5:1 on background, card, muted (${theme})`, () => {
    for (const s of SURFACES) {
      const r = ratio(tok(theme, "price"), tok(theme, s));
      expect(r, `price on ${s} = ${fmt(r)}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it(`UI-02 · status text shades are at least 4.5:1 (${theme})`, () => {
    for (const name of ["warning-foreground", "success-foreground", "destructive", "primary"]) {
      for (const s of SURFACES) {
        const r = ratio(tok(theme, name), tok(theme, s));
        expect(r, `${name} on ${s} = ${fmt(r)}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it.each(["default", "outline", "ghost", "destructive", "gold", "secondary"] as const)(
    `UI-02 · Button variant %s text is at least 4.5:1 (${theme})`,
    (variant) => {
      const classes = buttonVariants({ variant });
      const r = ratiosOf(classes, theme);
      // ghost has no fill or text token: it inherits foreground, covered above.
      if (variant === "ghost") return;
      expect(r, classes).not.toBeNull();
      for (const x of r!) expect(x.value, `${variant}: ${x.label} = ${fmt(x.value)}`).toBeGreaterThanOrEqual(AA);
    },
  );

  it(`UI-02 · every Button variant is covered (${theme})`, () => {
    const src = readFileSync(path.join(SRC, "components", "ui", "button.tsx"), "utf8");
    const variants = src.slice(src.indexOf("variant: {"), src.indexOf("size:"));
    const declared = [...variants.matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]!).sort();
    expect(declared).toEqual(["default", "destructive", "ghost", "gold", "outline", "secondary"]);
  });

  it(`UI-02 · every badge, status chip and text colour used in src/ is at least 4.5:1 (${theme})`, () => {
    expect(LITERALS.length).toBeGreaterThan(30); // the scan found the call sites
    const failures: string[] = [];
    let checked = 0;
    for (const { file, text } of LITERALS) {
      const r = ratiosOf(text, theme);
      if (!r) continue;
      checked++;
      for (const x of r) if (x.value < AA) failures.push(`${file}: "${text}" -> ${x.label} = ${fmt(x.value)}`);
    }
    expect(checked).toBeGreaterThan(20);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it(`UI-02 · the order status chips are covered, including the new secondary chip (${theme})`, async () => {
    const { STATUS_CLASS } = await import("@/lib/orders");
    for (const [status, classes] of Object.entries(STATUS_CLASS)) {
      const r = ratiosOf(classes, theme);
      expect(r, status).not.toBeNull();
      for (const x of r!) expect(x.value, `${status}: ${x.label} = ${fmt(x.value)}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it(`UI-02 · meaningful graphics are at least 3:1: ring and form-field border (${theme})`, () => {
    for (const s of SURFACES) {
      expect(ratio(tok(theme, "ring"), tok(theme, s)), `ring on ${s}`).toBeGreaterThanOrEqual(3);
      expect(ratio(tok(theme, "input"), tok(theme, s)), `input on ${s}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("UI-02 · no leftovers of the old palette", () => {
  it("UI-02 · no text-white, raw warning/gold text or accent token classes in src/", () => {
    const bad = LITERALS.filter(({ text }) =>
      text.split(/\s+/).some((c) => /^(?:text-white|text-warning|text-gold|text-accent|bg-accent)$/.test(c)),
    );
    expect(bad.map((b) => `${b.file}: ${b.text}`)).toEqual([]);
  });
});
