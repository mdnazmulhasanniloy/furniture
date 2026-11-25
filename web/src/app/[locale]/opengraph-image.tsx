import { readFileSync } from "node:fs";
import path from "node:path";

import { ImageResponse } from "next/og";

import { getSettings } from "@/lib/api/public";
import { pick } from "@/lib/pick";

/**
 * The share image is drawn by satori, which has no stylesheet, so the two colours it needs are read
 * out of the one token file (UI-01 / rule 2: no colour literals outside `globals.css`).
 */
function token(name: string, fallback: string): string {
  try {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    return new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * The default share image for every page under this locale (QA B7). Drawn here from the theme colours
 * and the store name - no photograph, so nothing depends on the placeholder images whose licensing is
 * still open (B-038). A page with a picture of its own (a product's main photo) overrides it.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Furnixa";

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const settings = await getSettings();
  const brand = pick(settings?.storeName, locale) || "Furnixa";
  const tagline = pick(settings?.seo?.description, locale);
  const rtl = locale === "ar";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          // design-system tokens, read from globals.css
          background: token("primary", "black"),
          color: token("primary-foreground", "white"),
          fontSize: 72,
          letterSpacing: rtl ? 0 : -1,
          padding: 80,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 96 }}>{brand}</div>
        {tagline ? <div style={{ fontSize: 40, opacity: 0.85 }}>{tagline.slice(0, 120)}</div> : null}
      </div>
    ),
    size,
  );
}
