import { defineConfig, devices } from "@playwright/test";

// E2E_PORT lets e2e run when :3100 is occupied (dev convention stays next dev -p 3100).
const PORT = process.env.E2E_PORT ?? "3100";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production server: next/font only emits its per-locale preload links in
    // production builds (dev serves no font preloads), and prod is what ships.
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/ar`,
    // Never reuse: an unrelated server on the port would otherwise be tested silently.
    // If the port is busy, Playwright fails fast — set E2E_PORT to a free one.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
