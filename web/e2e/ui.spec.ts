import { expect, test, type Page } from "@playwright/test";

// UI-01 — design tokens and per-locale fonts actually applied.

// white --background #FFFFFF → rgb(255, 255, 255) (CR-007 "Emerald and gold")
const LINEN_RGB = "rgb(255, 255, 255)";

// Next's font-preload manifest is per route entry; [locale] is one entry, so
// next/font preload would ship BOTH locales' fonts to everyone. Fonts therefore use
// preload: false, and locale scoping happens through per-locale @font-face CSS
// (src/fonts/*). This audit verifies the real goal at the network level: a locale
// only ever DOWNLOADS its own font files. The preload-link check stays as a
// regression guard in case preload is ever switched back on.
async function fontNetworkAudit(page: Page, url: string) {
  const downloaded: string[] = [];
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.endsWith(".woff2")) downloaded.push(pathname.split("/").pop()!);
  });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(500);

  // filename -> font-family, from the @font-face rules of the loaded CSS
  const familyByFile = await page.evaluate(() => {
    const map: Record<string, string> = {};
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          const src = rule.style.getPropertyValue("src");
          const match = /url\(["']?([^"')]+)["']?\)/.exec(src);
          if (match) {
            const file = match[1].split("/").pop()!.split("?")[0];
            map[file] = rule.style.getPropertyValue("font-family");
          }
        }
      }
    }
    return map;
  });
  const preloadFiles = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('link[rel="preload"][as="font"]'),
    ).map((l) => new URL((l as HTMLLinkElement).href).pathname.split("/").pop()!),
  );
  const family = (file: string) => familyByFile[file] ?? `<no @font-face for ${file}>`;
  return {
    downloadedFamilies: downloaded.map(family),
    preloadedFamilies: preloadFiles.map(family),
  };
}

test.describe("UI-01 — tokens, fonts and locale-scoped preloads", () => {
  for (const locale of ["en", "ar"] as const) {
    test(`UI-01: body uses the white --background token in /${locale}`, async ({
      page,
    }) => {
      await page.goto(`/${locale}`);
      const bg = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );
      expect(bg).toBe(LINEN_RGB);
    });
  }

  test("UI-01: /en headings use Bodoni Moda, body uses IBM Plex Sans", async ({ page }) => {
    await page.goto("/en");
    const h1Font = await page.locator("h1").first().evaluate((el) => getComputedStyle(el).fontFamily);
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(h1Font).toMatch(/Bodoni/i);
    expect(bodyFont).toMatch(/IBM[_ ]?Plex[_ ]?Sans/i);
    expect(bodyFont).not.toMatch(/Arabic/i);
  });

  test("UI-01: /ar headings use El Messiri, body uses IBM Plex Sans Arabic", async ({ page }) => {
    await page.goto("/ar");
    const h1Font = await page.locator("h1").first().evaluate((el) => getComputedStyle(el).fontFamily);
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(h1Font).toMatch(/El[_ ]?Messiri/i);
    expect(bodyFont).toMatch(/Plex[_ ]?Sans[_ ]?Arabic/i);
  });

  test("UI-01: /en downloads/preloads only Latin fonts (no Arabic font family)", async ({ page }) => {
    const audit = await fontNetworkAudit(page, "/en");
    expect(audit.downloadedFamilies.length).toBeGreaterThan(0);
    for (const family of audit.downloadedFamilies) {
      expect(family).toMatch(/Bodoni|IBM[_ ]Plex[_ ]Sans/i);
      expect(family).not.toMatch(/Arabic/i);
    }
    for (const family of audit.preloadedFamilies) expect(family).not.toMatch(/Arabic/i);
  });

  test("UI-01: /ar downloads/preloads no Latin-only body font (IBM Plex Sans without Arabic)", async ({ page }) => {
    const audit = await fontNetworkAudit(page, "/ar");
    expect(audit.downloadedFamilies.length).toBeGreaterThan(0);
    for (const family of audit.downloadedFamilies) {
      expect(family).toMatch(/El[_ ]Messiri|Plex[_ ]Sans[_ ]Arabic/i);
      expect(family).not.toMatch(/IBM[_ ]Plex[_ ]Sans(?![_ ]Arabic)/i);
    }
    for (const family of audit.preloadedFamilies) expect(family).not.toMatch(/IBM[_ ]Plex[_ ]Sans(?![_ ]Arabic)/i);
  });
});
