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
 * T-085 steps 3-5: the look editor. A point is placed on the photo, dragged or nudged with the keyboard, and
 * linked to a published product; the photo's own pixel size travels with it (backend T-110), which is what
 * keeps the point on the same spot of the photo at every screen width.
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

const product = (id: string, name: string, status = "PUBLISHED") => ({
  id,
  title: { en: name, ar: `${name} ع` },
  slug: id,
  price: 120_000,
  status,
  images: [{ key: `k-${id}`, url: `https://cdn.test/${id}.webp`, alt: null, width: 800, height: 600 }],
});
const slim = (p: ReturnType<typeof product>) => ({
  id: p.id,
  title: p.title,
  slug: p.slug,
  price: p.price,
  status: p.status,
  image: p.images[0],
});
const CATALOGUE = [
  product("p1", "Armchair"),
  product("p2", "Floor lamp"),
  product("p3", "Sofa"),
  product("p4", "Side table"),
  product("p5", "Rug"),
  product("p6", "Mirror"),
  product("p7", "Vase"),
];

const existingLook = {
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
        width: 1600,
        height: 1200,
      },
      hotspots: [
        { x: 20, y: 60, productId: "p1", product: slim(CATALOGUE[0]) },
        { x: 60, y: 40, productId: "p3", product: { ...slim(CATALOGUE[2]), status: "DRAFT" } },
      ],
    },
  },
  sortOrder: 2,
  isVisible: true,
  updatedAt: "2026-11-20T10:00:00.000Z",
};
const plainSection = {
  id: "s1",
  type: "CATEGORY_GRID",
  title: { en: "Shop by room", ar: "تسوق حسب الغرفة" },
  subtitle: null,
  config: null,
  sortOrder: 1,
  isVisible: true,
  updatedAt: "2026-11-20T10:00:00.000Z",
};

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let sections: unknown[] = [];
let failNext: { status: number; code: string } | null = null;
let uploadSeq = 0;

function stubApi() {
  calls = [];
  sections = [plainSection, existingLook];
  failNext = null;
  uploadSeq = 0;
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh") return json({ accessToken: "at-1", user: adminUser });
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path.startsWith("/admin/")) calls.push({ method, path, body });
      if (path === "/admin/uploads/presign") {
        uploadSeq += 1;
        return json({
          key: `furnixa/test/2026/11/new-${uploadSeq}.webp`,
          uploadUrl: "https://r2.test/secret-presigned-put?sig=SECRET",
          publicUrl: `https://cdn.test/new-${uploadSeq}.webp`,
        });
      }
      if (method !== "GET" && failNext) {
        const f = failNext;
        failNext = null;
        return json({ code: f.code, message: "Raw English API text", details: { productIds: ["p3"] } }, f.status);
      }
      if (path === "/admin/home-sections" && method === "GET") return json(sections);
      if (path.startsWith("/admin/products?")) {
        const qs = new URLSearchParams(path.split("?")[1]);
        const q = (qs.get("q") ?? "").toLowerCase();
        const items = CATALOGUE.filter(
          (p) => qs.get("status") === "PUBLISHED" && (!q || p.title.en.toLowerCase().includes(q)),
        );
        return json({ items, meta: { page: 1, limit: 20, total: items.length, totalPages: 1 } });
      }
      if (path === "/admin/home-sections" && method === "POST") return json({ ...existingLook, id: "new" }, 201);
      const m = /^\/admin\/home-sections\/([^/?]+)$/.exec(path);
      if (m && method === "PATCH") return json(existingLook);
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

// Fake XHR for the presigned PUT (no network), as in the banner tests.
class FakeXHR {
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  open() {}
  setRequestHeader() {}
  send() {
    setTimeout(() => {
      this.status = 200;
      this.onload?.();
    }, 0);
  }
}

/** The canvas is 1000 x 500 CSS pixels at the origin, so a click at (200, 250) is 20% / 50%. */
const RECT = {
  left: 0,
  top: 0,
  width: 1000,
  height: 500,
  right: 1000,
  bottom: 500,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

function mount(path: string) {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
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
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT);
});
afterEach(() => {
  configureApiClient(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const writes = () => calls.filter((c) => c.method !== "GET" && !c.path.includes("presign"));
const file = (name = "room.webp", type = "image/webp") => new File(["x"], name, { type });

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("T-085 · the look editor (%s)", (locale, msgs) => {
  const k = msgs.sections.looks.editor;
  const L = locale as Locale;
  beforeEach(async () => {
    initI18n(L);
    await setLocale(L);
  });

  const openNew = async () => {
    mount("/sections/looks/new");
    await screen.findByTestId("look-editor");
  };
  const openEdit = async () => {
    mount("/sections/looks/l1");
    await screen.findByTestId("look-editor");
  };
  const fillTitles = () => {
    fireEvent.change(screen.getByLabelText(msgs.sections.form.titleEn), { target: { value: "Evening room" } });
    fireEvent.change(screen.getByLabelText(msgs.sections.form.titleAr), { target: { value: "غرفة مسائية" } });
  };
  const uploadPhoto = async () => {
    fireEvent.change(screen.getByTestId("look-photo-input"), { target: { files: [file()] } });
    await waitFor(() =>
      expect(within(screen.getByTestId("look-photo")).getByTestId("uploader-item").getAttribute("data-status")).toBe(
        "done",
      ),
    );
  };
  const fillAlt = (en_ = "A living room", ar_ = "غرفة معيشة") => {
    const box = within(screen.getByTestId("look-photo"));
    fireEvent.change(box.getByLabelText(msgs.uploader.altEnN.replace("{n}", "1")), { target: { value: en_ } });
    fireEvent.change(box.getByLabelText(msgs.uploader.altArN.replace("{n}", "1")), { target: { value: ar_ } });
  };
  /** The browser reports the photo's real pixel size once it has loaded; jsdom needs a nudge. */
  const loadPhoto = async (width = 2000, height = 1000) => {
    const img = await screen.findByTestId("look-canvas-image");
    Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
    fireEvent.load(img);
  };
  const canvas = () => screen.getByTestId("look-canvas");
  const addPoint = (xPct: number, yPct: number) =>
    fireEvent.click(canvas(), { clientX: (xPct / 100) * RECT.width, clientY: (yPct / 100) * RECT.height });
  const points = () => screen.getAllByTestId("look-point");
  const choose = async (index: number, name: string) => {
    fireEvent.click(within(screen.getAllByTestId("look-point-row")[index]).getByTestId("look-choose"));
    const dialog = await screen.findByTestId("product-picker");
    fireEvent.change(within(dialog).getByTestId("product-picker-search"), { target: { value: name } });
    const row = await within(dialog).findByText(CATALOGUE.find((p) => p.title.en === name)!.title[L]);
    fireEvent.click(row.closest("button") as HTMLButtonElement);
    await waitFor(() => expect(screen.queryByTestId("product-picker")).toBeNull());
  };
  const save = () => fireEvent.click(screen.getByTestId("look-save"));

  it("T-085 · a new look starts empty, with the way back to the list", async () => {
    await openNew();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(k.titleNew);
    expect(screen.getByTestId("look-back").getAttribute("href")).toBe("/sections/looks");
    expect(screen.queryByTestId("look-canvas")).toBeNull(); // no photo yet, nothing to place points on
    expect(screen.getByText(k.addHint)).toBeTruthy();
  });

  it("T-085 · saving without a photo, without a point, or without alt text is refused before any request", async () => {
    await openNew();
    fillTitles();
    save();
    await waitFor(() => expect(screen.getByTestId("look-form-error").textContent).toBe(k.photoRequired));

    await uploadPhoto();
    await loadPhoto();
    save();
    await waitFor(() => expect(screen.getByTestId("look-form-error").textContent).toBe(k.altRequired));

    fillAlt();
    save();
    await waitFor(() => expect(screen.getByTestId("look-form-error").textContent).toBe(k.pointsRequired));
    expect(writes()).toHaveLength(0);
  });

  it("T-085 · clicking the photo adds a point where it was clicked, up to six", async () => {
    await openNew();
    await uploadPhoto();
    await loadPhoto();
    addPoint(20, 50);
    expect(points()).toHaveLength(1);
    expect(points()[0].style.left).toBe("20%");
    expect(points()[0].style.top).toBe("50%");

    for (const x of [30, 40, 50, 60, 70]) addPoint(x, 50);
    expect(points()).toHaveLength(6);
    addPoint(80, 50); // the seventh
    await waitFor(() => expect(screen.getByTestId("look-form-error").textContent).toBe(k.pointsMax));
    expect(points()).toHaveLength(6);
  });

  it("T-085 · the selected point moves 1% with an arrow, 5% with Shift, and never leaves the photo", async () => {
    await openNew();
    await uploadPhoto();
    await loadPhoto();
    addPoint(50, 50);
    const point = points()[0];
    fireEvent.keyDown(point, { key: "ArrowRight" });
    expect(points()[0].style.left).toBe("51%");
    fireEvent.keyDown(point, { key: "ArrowRight", shiftKey: true });
    expect(points()[0].style.left).toBe("56%");
    fireEvent.keyDown(point, { key: "ArrowUp", shiftKey: true });
    expect(points()[0].style.top).toBe("45%");
    for (let i = 0; i < 12; i++) fireEvent.keyDown(points()[0], { key: "ArrowUp", shiftKey: true });
    expect(points()[0].style.top).toBe("0%"); // clamped, never negative
  });

  it("T-085 · dragging a point moves it, with the pointer and with touch", async () => {
    await openNew();
    await uploadPhoto();
    await loadPhoto();
    addPoint(20, 20);
    const point = points()[0];
    // jsdom has no PointerEvent, so the move is dispatched as a MouseEvent of the same type - which is what
    // a real PointerEvent is, plus the pointer fields. The drag is also exercised for real in the e2e.
    fireEvent.pointerDown(point, { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent(window, new MouseEvent("pointermove", { clientX: 700, clientY: 400, bubbles: true }));
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
    expect(points()[0].style.left).toBe("70%");
    expect(points()[0].style.top).toBe("80%");
  });

  it("T-085 · Delete removes the selected point, and so does its button", async () => {
    await openNew();
    await uploadPhoto();
    await loadPhoto();
    addPoint(20, 20);
    addPoint(40, 40);
    fireEvent.keyDown(points()[1], { key: "Delete" });
    expect(points()).toHaveLength(1);
    fireEvent.click(within(screen.getAllByTestId("look-point-row")[0]).getByTestId("look-point-remove"));
    expect(screen.queryAllByTestId("look-point")).toHaveLength(0);
  });

  it("T-085 · a point needs a product, chosen from published products only", async () => {
    await openNew();
    fillTitles();
    await uploadPhoto();
    await loadPhoto();
    fillAlt();
    addPoint(20, 50);
    save();
    await waitFor(() => expect(screen.getByTestId("look-form-error").textContent).toBe(k.productRequired));
    expect(writes()).toHaveLength(0);

    await choose(0, "Armchair");
    const query = calls.find((c) => c.path.startsWith("/admin/products?"))!;
    expect(query.path).toContain("status=PUBLISHED");
    expect(within(screen.getAllByTestId("look-point-row")[0]).getByTestId("look-point-product").textContent).toContain(
      CATALOGUE[0].title[L],
    );
  });

  it("T-085 · the same product cannot be used twice in one look", async () => {
    await openNew();
    await uploadPhoto();
    await loadPhoto();
    addPoint(20, 50);
    addPoint(60, 50);
    await choose(0, "Armchair");
    fireEvent.click(within(screen.getAllByTestId("look-point-row")[1]).getByTestId("look-choose"));
    const dialog = await screen.findByTestId("product-picker");
    fireEvent.change(within(dialog).getByTestId("product-picker-search"), { target: { value: "Armchair" } });
    const row = await within(dialog).findByText(CATALOGUE[0].title[L]);
    expect((row.closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(k.duplicateProduct)).toBeTruthy();
  });

  it("T-085 · saving a new look sends the photo with its own size and every point", async () => {
    await openNew();
    fillTitles();
    await uploadPhoto();
    await loadPhoto(2400, 1600);
    fillAlt();
    addPoint(20, 50);
    addPoint(60, 40);
    await choose(0, "Armchair");
    await choose(1, "Floor lamp");
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    const w = writes()[0];
    expect(w.method).toBe("POST");
    expect(w.path).toBe("/admin/home-sections");
    expect(w.body).toMatchObject({
      type: "SHOP_THE_LOOK",
      title: { en: "Evening room", ar: "غرفة مسائية" },
      config: {
        look: {
          image: {
            key: "furnixa/test/2026/11/new-1.webp",
            alt: { en: "A living room", ar: "غرفة معيشة" },
            width: 2400,
            height: 1600,
          },
          hotspots: [
            { x: 20, y: 50, productId: "p1" },
            { x: 60, y: 40, productId: "p2" },
          ],
        },
      },
    });
    // The server builds the url and owns the product data; neither is ever sent back.
    const sent = JSON.stringify(w.body);
    expect(sent).not.toContain("cdn.test");
    expect(sent).not.toContain("secret");
    expect(sent).not.toContain('"product"');
    await waitFor(() => expect(screen.queryByTestId("look-editor")).toBeNull()); // back on the list
  });

  it("T-085 · editing an existing look loads it, keeps its photo, and saves with the version we loaded", async () => {
    await openEdit();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(k.titleEdit);
    expect(points()).toHaveLength(2);
    expect(points()[0].style.left).toBe("20%");
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    const w = writes()[0];
    expect(w.method).toBe("PATCH");
    expect(w.path).toBe("/admin/home-sections/l1");
    expect(w.body).toMatchObject({
      expectedUpdatedAt: "2026-11-20T10:00:00.000Z",
      config: {
        look: {
          image: { key: "furnixa/test/room.webp", width: 1600, height: 1200 },
          hotspots: [
            { x: 20, y: 60, productId: "p1" },
            { x: 60, y: 40, productId: "p3" },
          ],
        },
      },
    });
  });

  it("T-085 · a point whose product is no longer published says so, in the editor too", async () => {
    await openEdit();
    const rows = screen.getAllByTestId("look-point-row");
    expect(within(rows[0]).queryByTestId("look-point-warning")).toBeNull();
    expect(within(rows[1]).getByTestId("look-point-warning").textContent).toBe(k.productUnpublished);
  });

  it("T-085 · the API refusing a product is shown localized, never as the API's own words", async () => {
    await openEdit();
    failNext = { status: 422, code: "PRODUCT_NOT_PUBLISHED" };
    save();
    const error = await screen.findByTestId("look-form-error");
    expect(error.textContent).toBe(msgs.errors.PRODUCT_NOT_PUBLISHED);
    expect(document.body.textContent).not.toContain("Raw English API text");
    expect(screen.getByTestId("look-editor")).toBeTruthy(); // stays open so the point can be replaced
  });

  it("T-085 · a stale save offers to reload, as everywhere else", async () => {
    await openEdit();
    failNext = { status: 409, code: "STALE_UPDATE" };
    save();
    expect(await screen.findByTestId("look-stale")).toBeTruthy();
  });
});
