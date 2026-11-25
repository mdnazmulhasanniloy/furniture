import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { THEME_VARS, themeStyle } from "@/lib/theme-style";

/**
 * UI-03 (CR-010, ADR-017): the storefront applies the admin's chosen theme by writing the preset's
 * tokens into the `style` attribute of `<html>`, on the server. The values arrive from the API, so the
 * helper is the gate: only the known variable names and only `#rrggbb` ever reach the markup.
 *
 * The preset hexes below are the registry's (backend/src/lib/themes.ts). They appear only in this test
 * file, which `ui-01-no-raw-colours` exempts; no component may carry a colour value.
 */

const EMERALD = {
  primary: "#0f4c45",
  primaryForeground: "#ffffff",
  ring: "#0f4c45",
  muted: "#efe9dd",
  secondary: "#efe9dd",
  mutedForeground: "#5c6360",
  stone: "#6b726f",
  border: "#e4e0d6",
  input: "#7d8a85",
  gold: "#b8913a",
  goldStrong: "#9c7a2e",
  price: "#7a5e22",
  blush: "#f7eeea",
  champagne: "#c8a96a",
};
const WALNUT = {
  ...EMERALD,
  primary: "#6b3f2a",
  ring: "#6b3f2a",
  muted: "#f0e7dc",
  secondary: "#f0e7dc",
  mutedForeground: "#5e5249",
  stone: "#756a60",
  border: "#e6dcd0",
  input: "#85786c",
  gold: "#c58e4e",
  goldStrong: "#8f5f2a",
  price: "#77491b",
  blush: "#f8efe8",
  champagne: "#d2a977",
};

describe("UI-03 · theme variables on <html>", () => {
  it("UI-03 · a preset becomes the 14 CSS variables, named as globals.css names them", () => {
    const style = themeStyle(WALNUT) as Record<string, string>;
    expect(Object.keys(style)).toHaveLength(14);
    expect(style["--primary"]).toBe("#6b3f2a");
    expect(style["--primary-foreground"]).toBe("#ffffff");
    // camelCase token names become the kebab-case custom properties the stylesheet uses.
    expect(style["--muted-foreground"]).toBe("#5e5249");
    expect(style["--gold-strong"]).toBe("#8f5f2a");
    expect(style["--secondary"]).toBe(style["--muted"]);
    expect(style["--champagne"]).toBe("#d2a977");
    // Nothing else is themeable: ink, paper and the status colours stay with the stylesheet.
    for (const name of ["--background", "--foreground", "--destructive", "--success", "--warning"]) {
      expect(style[name]).toBeUndefined();
    }
  });

  it("UI-03 · nothing but a known name with a #rrggbb value reaches the markup", () => {
    const style = themeStyle({
      ...WALNUT,
      price: "red", // not a hex
      gold: "#fff", // short form
      stone: "javascript:alert(1)",
      border: "#12345g", // not hex digits
      background: "#000000", // not themeable
      "--primary": "#000000", // already a variable name
    } as unknown as Record<string, string>) as Record<string, string>;
    expect(style["--price"]).toBeUndefined();
    expect(style["--gold"]).toBeUndefined();
    expect(style["--stone"]).toBeUndefined();
    expect(style["--border"]).toBeUndefined();
    expect(style["--background"]).toBeUndefined();
    // The valid ones still apply: one bad value never costs the whole theme.
    expect(style["--primary"]).toBe("#6b3f2a");
    expect(Object.keys(style)).toHaveLength(10);
  });

  it("UI-03 · no theme, an empty map or junk falls back to the stylesheet defaults", () => {
    expect(themeStyle(undefined)).toBeUndefined();
    expect(themeStyle(null)).toBeUndefined();
    expect(themeStyle({})).toBeUndefined();
    expect(themeStyle({ nope: "#000000" } as unknown as Record<string, string>)).toBeUndefined();
    expect(themeStyle("walnut" as unknown as Record<string, string>)).toBeUndefined();
    // An uppercase hex is still a hex: the API is the only author, but be liberal in reading.
    expect((themeStyle({ primary: "#0F4C45" }) as Record<string, string>)["--primary"]).toBe(
      "#0F4C45",
    );
  });

  it("UI-03 · the emerald preset still equals the :root block of globals.css", () => {
    // The default must not drift from the registry: it is the one preset that is also written in CSS,
    // and the storefront renders it by sending no style at all.
    const css = readFileSync(
      path.resolve(import.meta.dirname, "..", "app", "globals.css"),
      "utf8",
    );
    const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
    const tokens: Record<string, string> = {};
    for (const m of root.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
      tokens[m[1]!] = m[2]!.toLowerCase();

    const style = themeStyle(EMERALD) as Record<string, string>;
    for (const [name, value] of Object.entries(style)) {
      expect(tokens[name.slice(2)], `globals.css ${name}`).toBe(value);
    }
    expect(THEME_VARS).toHaveLength(14);
  });
});
