import { expect, test, type Page } from "@playwright/test";

/**
 * T-085 step 4, in a real browser. jsdom has no PointerEvent and no layout, so the unit tests can only
 * simulate a drag; this measures the real thing: the point follows the mouse, follows a touch, lands where
 * the pointer is as a percentage of the photo, and the keyboard moves it by 1% / 5%.
 */
const admin = {
  id: "u1",
  firstName: "Sara",
  lastName: "Admin",
  email: "sara@furnixa.test",
  role: "ADMIN",
  isVerified: true,
  isBlocked: false,
  preferredLocale: "ar",
};

// A 2:1 photo (inline SVG, no network): the canvas renders it at its own ratio.
const PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#cbb9a8"/></svg>`,
  );

const look = {
  id: "l1",
  type: "SHOP_THE_LOOK",
  title: { en: "Evening living room", ar: "غرفة معيشة مسائية" },
  subtitle: null,
  config: {
    look: {
      image: { key: "furnixa/test/room.svg", url: PHOTO, alt: { en: "A living room", ar: "غرفة معيشة" }, width: 1200, height: 600 },
      hotspots: [
        {
          x: 20,
          y: 20,
          productId: "p1",
          product: {
            id: "p1",
            title: { en: "Armchair", ar: "كرسي" },
            slug: "armchair",
            price: 120000,
            status: "PUBLISHED",
            image: null,
          },
        },
      ],
    },
  },
  sortOrder: 1,
  isVisible: true,
  updatedAt: "2026-11-20T10:00:00.000Z",
};

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

test.beforeEach(async ({ page }) => {
  // Playwright matches the LAST registered route first, so the catch-all goes in first.
  await page.route("**/api/v1/**", (route) => route.fulfill(json({ code: "NOT_FOUND" }, 404)));
  await page.route("**/api/v1/auth/csrf", (route) => route.fulfill(json({ csrfToken: "c1" })));
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill(json({ accessToken: "at-1", user: admin })));
  await page.route("**/api/v1/admin/home-sections", (route) => route.fulfill(json([look])));
  await page.goto("/sections/looks/l1");
  await expect(page.getByTestId("look-canvas")).toBeVisible();
});

/** Where the point sits, as a percentage of the photo - exactly what gets saved. */
async function position(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="look-canvas"]') as HTMLElement;
    const point = document.querySelector('[data-testid="look-point"]') as HTMLElement;
    const c = canvas.getBoundingClientRect();
    const p = point.getBoundingClientRect();
    return {
      x: ((p.left + p.width / 2 - c.left) / c.width) * 100,
      y: ((p.top + p.height / 2 - c.top) / c.height) * 100,
    };
  });
}
const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(0.6);

test("T-085 · the point follows the mouse and lands where the pointer is", async ({ page }) => {
  await page.getByTestId("look-canvas").scrollIntoViewIfNeeded(); // the mouse works in viewport coordinates
  const box = (await page.getByTestId("look-canvas").boundingBox())!;
  const start = await position(page);
  near(start.x, 20);
  near(start.y, 20);

  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();

  const after = await position(page);
  near(after.x, 70);
  near(after.y, 60);
});

test("T-085 · the point follows a touch, on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("look-canvas").scrollIntoViewIfNeeded();
  const box = (await page.getByTestId("look-canvas").boundingBox())!;
  const from = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.2 };
  const to = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.75 };
  // A real touch sequence: Chromium turns these into pointer events with pointerType "touch".
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: to.x, y: to.y }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  const after = await position(page);
  near(after.x, 50);
  near(after.y, 75);
});

test("T-085 · the keyboard moves the selected point by 1% and 5%, and the photo is never cropped", async ({ page }) => {
  const point = page.getByTestId("look-point");
  await point.focus();
  await point.press("ArrowRight");
  near((await position(page)).x, 21);
  await point.press("Shift+ArrowRight");
  near((await position(page)).x, 26);
  await point.press("Shift+ArrowDown");
  near((await position(page)).y, 25);

  // The canvas is the photo: same box, so a percentage means the same place in the editor and on the site.
  const ratio = await page.evaluate(() => {
    const c = (document.querySelector('[data-testid="look-canvas"]') as HTMLElement).getBoundingClientRect();
    const img = document.querySelector('[data-testid="look-canvas-image"]') as HTMLImageElement;
    const i = img.getBoundingClientRect();
    return { canvas: c.width / c.height, image: i.width / i.height, sameBox: Math.abs(c.height - i.height) < 1 };
  });
  expect(ratio.sameBox).toBe(true);
  expect(Math.abs(ratio.canvas - 2)).toBeLessThan(0.02); // the photo's own 1200x600 ratio
});
