import type { CSSProperties } from "react";

/**
 * UI-03 (CR-010, ADR-017): the admin chooses a colour preset, and the storefront applies it by writing the
 * preset's tokens into the `style` attribute of `<html>`. Tailwind v4 maps every colour utility to
 * `var(--token)` (the `@theme inline` block in globals.css), so overriding those variables retints the whole
 * site with no client script; the style is rendered on the server, so the first byte already carries the
 * theme and there is no flash of the default.
 *
 * The values come from the API, so this helper is the gate: only the 14 known names, only `#rrggbb`. One bad
 * value is dropped, not the whole theme; nothing at all leaves the CSS defaults (emerald) in place.
 */

/** Token name from the API -> the custom property globals.css declares. */
const VARS = {
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  ring: "--ring",
  muted: "--muted",
  secondary: "--secondary",
  mutedForeground: "--muted-foreground",
  stone: "--stone",
  border: "--border",
  input: "--input",
  gold: "--gold",
  goldStrong: "--gold-strong",
  price: "--price",
  blush: "--blush",
  champagne: "--champagne",
} as const;

export const THEME_VARS = Object.values(VARS);

const HEX = /^#[0-9a-fA-F]{6}$/;

export function themeStyle(tokens: unknown): CSSProperties | undefined {
  if (typeof tokens !== "object" || tokens === null) return undefined;
  const map = tokens as Record<string, unknown>;
  const style: Record<string, string> = {};
  for (const [token, cssVar] of Object.entries(VARS)) {
    const value = map[token];
    if (typeof value === "string" && HEX.test(value)) style[cssVar] = value;
  }
  // Nothing usable: let :root win, rather than putting an empty attribute on every page.
  return Object.keys(style).length > 0 ? (style as CSSProperties) : undefined;
}
