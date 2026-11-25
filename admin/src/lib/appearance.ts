import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { LocalizedText } from "@/lib/products";

// api-spec.yaml /admin/settings/appearance (ADM-16, CR-010, ADR-017). The presets are a backend registry,
// so this module never holds a colour value: the cards paint themselves from the tokens the API sends.
// The PATCH touches only the theme, so the other Settings tabs keep working while it is applied; it shares
// the settings document's `updatedAt`, hence the same `expectedUpdatedAt` rule (409 STALE_UPDATE).

/** The 14 tokens a preset carries. Names are the API's; the CSS variables are derived in the panel. */
export type ThemeTokens = {
  primary: string;
  primaryForeground: string;
  ring: string;
  muted: string;
  secondary: string;
  mutedForeground: string;
  stone: string;
  border: string;
  input: string;
  gold: string;
  goldStrong: string;
  price: string;
  blush: string;
  champagne: string;
};

export type ThemePreset = { id: string; name: LocalizedText; tokens: ThemeTokens };

export type SiteAppearance = {
  themeId: string;
  presets: ThemePreset[];
  themeUpdatedAt?: string | null;
  updatedAt: string;
};

const KEY = ["admin", "appearance"] as const;

export function useAppearance() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api.get<SiteAppearance>("/admin/settings/appearance", { signal }),
  });
}

export function useApplyTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { themeId: string; expectedUpdatedAt: string }) =>
      api.patch<SiteAppearance>("/admin/settings/appearance", body),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      // The write moved the settings document's `updatedAt`, so the open Settings form must pick up the
      // new one or its next save would be refused as stale.
      void qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
  });
}

/** Token name -> the CSS custom property, so a preview can be painted by setting them on one container. */
const VARS: Record<keyof ThemeTokens, string> = {
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
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The preset's variables, for the card's own container only - never for `<html>`: the dashboard keeps its
 * own colours (and its own dark mode) while the owner browses presets. Values come from the API, so only
 * known names and `#rrggbb` are let through, exactly as the storefront helper does.
 */
export function previewStyle(tokens: ThemeTokens | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tokens) return out;
  for (const [token, cssVar] of Object.entries(VARS)) {
    const value = (tokens as Record<string, unknown>)[token];
    if (typeof value === "string" && HEX.test(value)) out[cssVar] = value;
  }
  return out;
}

/** The five swatches a card shows, in a fixed order, each with a text label (never colour alone). */
export const SWATCHES = [
  { key: "primary", token: "primary" },
  { key: "accent", token: "gold" },
  { key: "surface", token: "muted" },
  { key: "text", token: "mutedForeground" },
  { key: "price", token: "price" },
] as const satisfies readonly { key: string; token: keyof ThemeTokens }[];
