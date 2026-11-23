import { expect, test } from "@playwright/test";

// Baseline security headers (T-030). A full CSP is T-042.
test.describe("Security headers", () => {
  for (const locale of ["en", "ar"] as const) {
    test(`baseline security headers are sent on /${locale}`, async ({ request }) => {
      const response = await request.get(`/${locale}`);
      expect(response.ok()).toBe(true);
      const headers = response.headers();
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["x-frame-options"]).toBe("DENY");
      expect(headers["permissions-policy"]).toContain("camera=()");
      expect(headers["permissions-policy"]).toContain("microphone=()");
      expect(headers["permissions-policy"]).toContain("geolocation=()");
    });
  }
});
