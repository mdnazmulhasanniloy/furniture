import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { badgeVariants } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

// UI-02 / SRC-008.5 / ADR-014: the AA gate reads the REAL token values from globals.css and the
// REAL class strings of the Button and Badge variants. A token or variant edit that breaks AA fails.

const CSS = readFileSync(path.resolve(import.meta.dirname, "..", "app", "globals.css"), "utf8");
const rootBlock = CSS.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
const TOKENS: Record<string, string> = {};
for (const m of rootBlock.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) TOKENS[m[1]!] = m[2]!;

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const lum = ([r, g, b]: RGB) => {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const blend = (fg: RGB, bg: RGB, alpha: number): RGB =>
  fg.map((v, i) => Math.round(v * alpha + bg[i]! * (1 - alpha))) as RGB;
const tok = (name: string): RGB => {
  const hex = TOKENS[name];
  if (!hex) throw new Error(`token --${name} not found in globals.css`);
  return rgb(hex);
};

const SURFACES = ["background", "card", "muted"] as const;

/** The fill and text token a class string names (explicit `bg-x` / `text-x`, optional `/alpha`). */
function pairOf(classes: string) {
  const list = classes.split(/\s+/).filter((c) => !c.includes(":"));
  let bg: { name: string; alpha: number } | null = null;
  let fg = "foreground";
  for (const c of list) {
    const b = c.match(/^bg-([a-z-]+?)(?:\/(\d+))?$/);
    if (b && b[1]! in TOKENS) bg = { name: b[1]!, alpha: b[2] ? Number(b[2]) / 100 : 1 };
    const t = c.match(/^text-([a-z-]+)$/);
    if (t && t[1]! in TOKENS) fg = t[1]!;
  }
  return { bg, fg };
}

/** Contrast of a variant's text against its fill (composited over every surface when translucent). */
function variantRatios(classes: string): number[] {
  const { bg, fg } = pairOf(classes);
  if (!bg) return SURFACES.map((s) => ratio(tok(fg), tok(s)));
  return SURFACES.map((s) => {
    const fill = bg.alpha < 1 ? blend(tok(bg.name), tok(s), bg.alpha) : tok(bg.name);
    return ratio(tok(fg), fill);
  });
}

const AA = 4.5;
const fmt = (n: number) => n.toFixed(2);

describe("UI-02 · AA contrast on the design tokens (ADR-014)", () => {
  it("UI-02 · the parser reads the token block and the brief's values", () => {
    expect(Object.keys(TOKENS).length).toBeGreaterThan(15);
    expect(TOKENS.primary).toBe("#0f4c45");
    expect(TOKENS.gold).toBe("#c8a24a");
    expect(TOKENS.price).toBe("#86672a");
    expect(TOKENS.accent).toBeUndefined();
  });

  it.each(["foreground", "muted-foreground"])(
    "UI-02 · %s text is at least 4.5:1 on background, card and muted",
    (name) => {
      for (const s of SURFACES) {
        const r = ratio(tok(name), tok(s));
        expect(r, `${name} on ${s} = ${fmt(r)}`).toBeGreaterThanOrEqual(AA);
      }
    },
  );

  it("UI-02 · the price colour is at least 4.5:1 on background, card, muted and secondary", () => {
    for (const s of [...SURFACES, "secondary"]) {
      const r = ratio(tok("price"), tok(s));
      expect(r, `price on ${s} = ${fmt(r)}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("UI-02 · status text shades are at least 4.5:1 on their surfaces", () => {
    for (const name of ["warning-foreground", "success-foreground", "destructive"]) {
      for (const s of SURFACES) {
        const r = ratio(tok(name), tok(s));
        expect(r, `${name} on ${s} = ${fmt(r)}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it("UI-02 · raw warning and raw gold are NOT usable as text (documented failures)", () => {
    expect(ratio(tok("warning"), tok("background"))).toBeLessThan(AA);
    expect(ratio(tok("gold"), tok("background"))).toBeLessThan(AA);
  });

  const buttonVariantNames = ["default", "destructive", "outline", "secondary", "gold", "ghost", "link"] as const;
  it.each(buttonVariantNames)("UI-02 · Button variant %s text is at least 4.5:1", (variant) => {
    const classes = buttonVariants({ variant });
    for (const r of variantRatios(classes)) expect(r, `${variant}: ${classes}`).toBeGreaterThanOrEqual(AA);
  });

  it('UI-02 · every Button variant is covered by this test', () => {
    const src = readFileSync(path.resolve(import.meta.dirname, '..', 'components', 'ui', 'button.tsx'), 'utf8');
    const block = src.slice(src.indexOf('variant: {'), src.indexOf('size: {'));
    const declared = [...block.matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]!);
    expect(declared.length).toBeGreaterThan(5);
    expect([...declared].sort()).toEqual([...buttonVariantNames].sort());
  });

  const badgeNames = ["new", "preowned", "featured", "soldOut", "warning", "success", "destructive"] as const;
  it.each(badgeNames)("UI-02 · Badge variant %s text is at least 4.5:1", (variant) => {
    const classes = badgeVariants({ variant });
    for (const r of variantRatios(classes)) expect(r, `${variant}: ${classes}`).toBeGreaterThanOrEqual(AA);
  });

  it("UI-02 · the owner's badge pairs are used: New primary/white, Pre-owned secondary, Featured gold", () => {
    expect(pairOf(badgeVariants({ variant: "new" }))).toEqual({ bg: { name: "primary", alpha: 1 }, fg: "primary-foreground" });
    expect(pairOf(badgeVariants({ variant: "preowned" }))).toEqual({ bg: { name: "secondary", alpha: 1 }, fg: "secondary-foreground" });
    expect(pairOf(badgeVariants({ variant: "featured" }))).toEqual({ bg: { name: "gold", alpha: 1 }, fg: "gold-foreground" });
  });

  it("UI-02 · meaningful graphics are at least 3:1 (ring, form-field border, free-delivery bar)", () => {
    for (const s of SURFACES) {
      expect(ratio(tok("ring"), tok(s)), `ring on ${s}`).toBeGreaterThanOrEqual(3);
      expect(ratio(tok("input"), tok(s)), `input on ${s}`).toBeGreaterThanOrEqual(3);
    }
    for (const s of ["background", "muted"]) {
      expect(ratio(tok("gold-strong"), tok(s)), `gold-strong on ${s}`).toBeGreaterThanOrEqual(3);
    }
  });
});
