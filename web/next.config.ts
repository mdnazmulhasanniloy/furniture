import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

type RemotePattern = NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number];

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Images are served from Cloudflare R2 (ADR-010), either via the r2.dev public URL
// or via our custom domain (the URL stored in the database). Every host an image can
// come from must be allowed in images.remotePatterns or next/image returns 400.

// Hosts that always work, locally and on Vercel, even with no env set.
const DEFAULT_IMAGE_HOSTS = ["**.r2.dev", "**.ssdesigngallery.com"];

// Extra hosts from env: R2_PUBLIC_BASE_URL plus a comma-separated IMAGE_EXTRA_BASE_URLS.
// Accepts full URLs ("https://cdn.example.com/") or bare hosts ("cdn.example.com").
const toHostname = (value: string): string | null => {
  const v = value.trim().replace(/\/+$/, "");
  if (!v) return null;
  try {
    return new URL(v.includes("://") ? v : `https://${v}`).hostname;
  } catch {
    return null;
  }
};

const envHosts = [
  process.env.R2_PUBLIC_BASE_URL ?? "",
  ...(process.env.IMAGE_EXTRA_BASE_URLS ?? "").split(","),
]
  .map(toHostname)
  .filter((h): h is string => Boolean(h));

const imageHosts = [...new Set([...DEFAULT_IMAGE_HOSTS, ...envHosts])];

const imageRemotePatterns: RemotePattern[] = imageHosts.map((hostname) => ({
  protocol: "https",
  hostname,
  pathname: "/**",
}));

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
    remotePatterns: imageRemotePatterns,
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