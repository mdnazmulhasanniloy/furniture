/**
 * Colour presets for the storefront (CR-010, ADR-017 + its 2026-11-25 correction).
 *
 * The registry lives here, in the backend, and nowhere else: the public settings response carries the
 * applied preset's tokens and the admin appearance response carries all of them, so neither the web nor
 * the admin holds a copy of a colour value that could drift (the three apps share no package, B-018).
 * No colour is ever stored in the database - only the id.
 *
 * A preset changes 14 CSS custom properties. Paper (#ffffff), ink (#14201d), --blush-foreground,
 * --gold-foreground and every status colour (destructive, success, warning) are fixed in all presets, so
 * an order or stock state reads the same in every theme. Every preset is a light theme.
 *
 * Values and their computed contrast ratios: project-docs/03-design/design-system.md section 1b and
 * project-docs/05-delivery/cr-010-plan.md. The gate that keeps them honest is
 * tests/cms/appearance.test.ts, which uses the same formula as the web and admin AA tests: a preset that
 * fails WCAG AA on paper, --muted or --blush fails CI.
 */

/** Emerald is first: it is the default, and the values in web/src/app/globals.css. */
export const THEME_IDS = ['emerald', 'walnut', 'charcoal', 'sand', 'burgundy'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** The 14 variables a theme may change. `secondary` always mirrors `muted`. */
export const THEME_TOKEN_KEYS = [
  'primary',
  'primaryForeground',
  'ring',
  'muted',
  'secondary',
  'mutedForeground',
  'stone',
  'border',
  'input',
  'gold',
  'goldStrong',
  'price',
  'blush',
  'champagne',
] as const;
export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];
export type ThemeTokens = Record<ThemeTokenKey, string>;

export type ThemePreset = {
  id: ThemeId;
  name: { en: string; ar: string };
  tokens: ThemeTokens;
};

/** Written once per preset so `secondary` can never disagree with `muted`. */
const preset = (
  id: ThemeId,
  name: { en: string; ar: string },
  tokens: Omit<ThemeTokens, 'secondary' | 'primaryForeground'>,
): ThemePreset => ({
  id,
  name,
  tokens: { ...tokens, secondary: tokens.muted, primaryForeground: '#ffffff' },
});

export const THEMES: readonly ThemePreset[] = [
  preset(
    'emerald',
    { en: 'Emerald', ar: 'الزمرد' },
    {
      primary: '#0f4c45',
      ring: '#0f4c45',
      muted: '#efe9dd',
      mutedForeground: '#5c6360',
      stone: '#6b726f',
      border: '#e4e0d6',
      input: '#7d8a85',
      gold: '#b8913a',
      goldStrong: '#9c7a2e',
      price: '#7a5e22',
      blush: '#f7eeea',
      champagne: '#c8a96a',
    },
  ),
  preset(
    'walnut',
    { en: 'Walnut', ar: 'الجوز' },
    {
      primary: '#6b3f2a',
      ring: '#6b3f2a',
      muted: '#f0e7dc',
      mutedForeground: '#5e5249',
      stone: '#756a60',
      border: '#e6dcd0',
      input: '#85786c',
      gold: '#c58e4e',
      goldStrong: '#8f5f2a',
      price: '#77491b',
      blush: '#f8efe8',
      champagne: '#d2a977',
    },
  ),
  preset(
    'charcoal',
    { en: 'Charcoal', ar: 'الفحم' },
    {
      primary: '#2b3236',
      ring: '#2b3236',
      muted: '#ecedee',
      mutedForeground: '#54595c',
      stone: '#6f7479',
      border: '#dfe1e2',
      input: '#7c8286',
      gold: '#a8905a',
      goldStrong: '#857037',
      price: '#5f5226',
      blush: '#f2f1ef',
      champagne: '#bfa878',
    },
  ),
  preset(
    'sand',
    { en: 'Sand', ar: 'الرمل' },
    {
      primary: '#4d4430',
      ring: '#4d4430',
      muted: '#e9e0cf',
      mutedForeground: '#5a5446',
      stone: '#6e6858',
      border: '#ddd3bf',
      input: '#80765f',
      gold: '#bca264',
      goldStrong: '#85702f',
      price: '#6e5a22',
      blush: '#f6f0e4',
      champagne: '#d0b882',
    },
  ),
  preset(
    'burgundy',
    { en: 'Burgundy', ar: 'العنابي' },
    {
      primary: '#6e1f2e',
      ring: '#6e1f2e',
      muted: '#f1e7e2',
      mutedForeground: '#5c4d4c',
      stone: '#776a68',
      border: '#e6dad4',
      input: '#85726f',
      gold: '#c09a5b',
      goldStrong: '#8c6a2c',
      price: '#76471c',
      blush: '#faefee',
      champagne: '#d3a878',
    },
  ),
];

export const DEFAULT_THEME_ID: ThemeId = 'emerald';

/**
 * A stored id is data, so it may be anything: null on a document written before CR-010, or an id that was
 * retired by a later release. Both answer the default rather than failing a page (ADR-017).
 */
export function resolveTheme(id: string | null | undefined): ThemePreset {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

export const isThemeId = (id: unknown): id is ThemeId =>
  typeof id === 'string' && (THEME_IDS as readonly string[]).includes(id);
