import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

/**
 * T-085 step 6: the preview must show what the website will show. The admin and the storefront are two
 * separate apps (different React stacks, no shared package), so the preview is a copy of the storefront's
 * markup rules - and a drift guard pins the handful of facts that decide where a dot lands.
 */
const adminUser = {
  id: "u1",
  firstName: "Sara",
  lastName: "Admin",
  email: "sara@furnixa.test",
  role: "ADMIN",
  isVerified: true,
  isBlocked: false,
  preferredLocale: "ar",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const look = {
  id: "l1",
  type: "SHOP_THE_LOOK",
  title: { en: "Evening living room", ar: "غرفة معيشة مسائية" },
  subtitle: { en: "Tap the dots", ar: "اضغط على النقاط" },
  config: {
    look: {
      image: {
        key: "furnixa/test/room.webp",
        url: "https://cdn.test/room.webp",
        alt: { en: "A living room", ar: "غرفة معيشة" },
        width: 1200,
        height: 600,
      },
      hotspots: [
        {
          x: 20,
          y: 60,
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
        {
          x: 72.5,
          y: 35,
          productId: "p2",
          product: {
            id: "p2",
            title: { en: "Floor lamp", ar: "مصباح أرضي" },
            slug: "lamp",
            price: 45000,
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

function stubApi() {
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string) => {
      const p = url.replace(/^.*\/api\/v1/, "");
      if (p === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (p === "/auth/refresh") return json({ accessToken: "at-1", user: adminUser });
      if (p === "/admin/home-sections") return json([look]);
      if (p.startsWith("/admin/products?"))
        return json({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } });
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount() {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/sections/looks/l1"]}>
          <App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  authStore.reset();
  localStorage.clear();
  stubApi();
  vi.stubGlobal("XMLHttpRequest", class {});
  // jsdom has no layout: without a box, a click on the photo is not a percentage of anything.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 500,
    right: 1000,
    bottom: 500,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  configureApiClient(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8");

describe("T-085 · the preview cannot drift from the website", () => {
  const preview = () => read("../components/look-preview.tsx");
  const storefront = () => read("../../../web/src/components/home/shop-the-look.tsx");

  it("T-085 · both place a dot with physical left/top percentages, so RTL never mirrors it", () => {
    for (const [name, src] of [
      ["preview", preview()],
      ["storefront", storefront()],
    ] as const) {
      expect(src, name).toContain("left: `${");
      expect(src, name).toContain("top: `${");
      // `start`/`end` would mirror in Arabic and move every dot off its object.
      expect(src, name).not.toMatch(/style=\{\{[^}]*\binsetInlineStart\b/);
    }
  });

  it("T-085 · both size and centre the dot the same way", () => {
    const dot = ["-ml-3.5", "-mt-3.5", "size-7", "rounded-full"];
    for (const cls of dot) {
      expect(preview(), `preview ${cls}`).toContain(cls);
      expect(storefront(), `storefront ${cls}`).toContain(cls);
    }
  });

  it("T-085 · both render the photo at its stored ratio and fall back to the old box without it", () => {
    for (const [name, src] of [
      ["preview", preview()],
      ["storefront", storefront()],
    ] as const) {
      expect(src, name).toContain("aspectRatio");
      expect(src, name).toContain("aspect-[4/5]");
      expect(src, name).toContain("object-cover");
    }
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("T-085 · the live preview (%s)", (locale, msgs) => {
  const k = msgs.sections.looks.editor;
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
  });

  it("T-085 · shows the look as the website will, one dot per point at its own percentages", async () => {
    mount();
    const preview = await screen.findByTestId("look-preview");
    expect(within(preview).getByText(look.title[locale])).toBeTruthy();
    const dots = within(preview).getAllByTestId("preview-dot");
    expect(dots).toHaveLength(2);
    expect(dots.map((d) => [d.style.left, d.style.top])).toEqual([
      ["20%", "60%"],
      ["72.5%", "35%"],
    ]);
    // The photo box takes the photo's own ratio, so those percentages mean the same here and on the site.
    expect(within(preview).getByTestId("preview-photo").style.aspectRatio).toBe("1200 / 600");
  });

  it("T-085 · the desktop and mobile toggles change the frame, and the dots stay put", async () => {
    mount();
    const preview = await screen.findByTestId("look-preview");
    const desktop = within(preview).getByTestId("look-preview-desktop");
    const mobile = within(preview).getByTestId("look-preview-mobile");
    expect(desktop.textContent).toBe(k.desktop);
    expect(mobile.textContent).toBe(k.mobile);
    expect(desktop.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(mobile);
    await waitFor(() => expect(mobile.getAttribute("aria-pressed")).toBe("true"));
    const frame = within(preview).getByTestId("preview-frame");
    expect(frame.style.width).toBe("390px"); // a phone, measured in CSS pixels
    expect(within(preview).getAllByTestId("preview-dot").map((d) => d.style.left)).toEqual(["20%", "72.5%"]);
  });

  it("T-085 · a point still being chosen is drawn too, so the preview follows the editing", async () => {
    mount();
    await screen.findByTestId("look-canvas");
    fireEvent.click(screen.getByTestId("look-canvas"), { clientX: 0, clientY: 0 });
    await waitFor(() =>
      expect(within(screen.getByTestId("look-preview")).getAllByTestId("preview-dot")).toHaveLength(3),
    );
  });
});
