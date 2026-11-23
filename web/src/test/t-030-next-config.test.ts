import { afterEach, describe, expect, it, vi } from "vitest";

// T-030 Done criteria: images.remotePatterns allows the R2_PUBLIC_BASE_URL host
// (ADR-010), and a production build without it fails with a clear error.

describe("T-030: next.config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows the R2_PUBLIC_BASE_URL host in images.remotePatterns", async () => {
    vi.resetModules();
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://pub-test-bucket.r2.dev");
    const config = (await import("../../next.config")).default;
    const patterns = config.images?.remotePatterns ?? [];
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toBeInstanceOf(URL);
    expect((patterns[0] as URL).hostname).toBe("pub-test-bucket.r2.dev");
  });

  it("fails a production build with a clear error when R2_PUBLIC_BASE_URL is missing", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "");
    await expect(import("../../next.config")).rejects.toThrow(
      /R2_PUBLIC_BASE_URL is required in production/,
    );
  });

  it("keeps the API proxy rewrite /api/:path* -> API_ORIGIN (ADR-011)", async () => {
    vi.resetModules();
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://pub-test-bucket.r2.dev");
    vi.stubEnv("API_ORIGIN", "https://api.example.test");
    const config = (await import("../../next.config")).default;
    const rewrites = await config.rewrites?.();
    expect(rewrites).toEqual([
      {
        source: "/api/:path*",
        destination: "https://api.example.test/api/:path*",
      },
    ]);
  });
});
