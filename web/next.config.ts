import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Images are served from Cloudflare R2 (ADR-010); the public host must be allowed
// in images.remotePatterns or next/image refuses the URL at runtime.
const r2PublicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
if (!r2PublicBaseUrl && process.env.NODE_ENV === "production") {
  throw new Error(
    "R2_PUBLIC_BASE_URL is required in production: next/image needs the R2 public host in images.remotePatterns (ADR-010). Set it in the environment, e.g. R2_PUBLIC_BASE_URL=https://pub-<id>.r2.dev",
  );
}

// `next dev` blocks dev resources requested from any host except localhost; opened from another IP or machine the page
// is served but never hydrates (no header, carousel or cart logic). Hosts to allow come from ALLOWED_DEV_ORIGINS.
const devOrigins = (list: string | undefined) =>
  (list ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins(process.env.ALLOWED_DEV_ORIGINS),
  images: {
    // Qualities the storefront asks for (UI-04, review item 5): 60 for cards, tiles and the look photo, 70 for the hero.
    qualities: [60, 70, 75],
    remotePatterns: r2PublicBaseUrl ? [new URL(`${r2PublicBaseUrl}/**`)] : [],
  },
  // Same-origin API proxy (ADR-011): the backend's host-only refresh cookie becomes
  // first-party on the storefront domain. Clients call /api/v1/... relative paths.
  // Socket.IO is NOT proxied — the socket client connects to the backend origin
  // directly at path /api/socket-io (ADR-012, web T-040).
  async rewrites() {
    const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:1000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
  // Baseline security headers (web T-030). Full CSP lands with T-042.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
