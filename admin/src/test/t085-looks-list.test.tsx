import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { moveAmongLooks } from "@/lib/looks";
import { ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

/**
 * T-085 step 2: the looks list. A look is a SHOP_THE_LOOK home section, so this page is a filtered view of
 * `/admin/home-sections` with the look-specific columns. Ordering goes through the same reorder endpoint,
 * which demands the *whole* id list, so moving a look may only swap it with the neighbouring look and must
 * leave every other section where it was.
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
  image: { key: `k-${id}`, url: `https://cdn.test/${id}.webp`, alt: null, width: 800, height: 600 },
});
const lookConfig = (points: { x: number; y: number; product: ReturnType<typeof product> | null }[]) => ({
  look: {
    image: {
      key: "k-room",
      url: "https://cdn.test/room.webp",
      alt: { en: "A living room", ar: "غرفة معيشة" },
      width: 1600,
      height: 1200,
    },
    hotspots: points.map((p, i) => ({
      x: p.x,
      y: p.y,
      productId: p.product?.id ?? `gone-${i}`,
      product: p.product,
    })),
  },
});

const mk = (id: string, type: string, enT: string, arT: string, sortOrder: number, extra: object = {}) => ({
  id,
  type,
  title: { en: enT, ar: arT },
  subtitle: null,
  config: null,
  sortOrder,
  isVisible: true,
  updatedAt: "2026-11-20T10:00:00.000Z",
  ...extra,
});

const healthy = lookConfig([
  { x: 20, y: 60, product: product("p1", "Armchair") },
  { x: 60, y: 40, product: product("p2", "Floor lamp") },
]);
const broken = lookConfig([
  { x: 30, y: 30, product: product("p3", "Sofa", "DRAFT") },
  { x: 70, y: 70, product: null },
]);

const base = () => [
  mk("s1", "CATEGORY_GRID", "Shop by room", "تسوق حسب الغرفة", 1),
  mk("l1", "SHOP_THE_LOOK", "Evening living room", "غرفة معيشة مسائية", 2, { config: healthy }),
  mk("s2", "FEATURED_PRODUCTS", "Featured", "مميز", 3),
  mk("l2", "SHOP_THE_LOOK", "Bright bedroom", "غرفة نوم مضيئة", 4, {
    config: broken,
    isVisible: false,
  }),
];

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let list = base();
let failNext: { status: number; code: string } | null = null;

function stubApi() {
  calls = [];
  list = base();
  failNext = null;
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh") return json({ accessToken: "at-1", user: adminUser });
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path.startsWith("/admin/")) calls.push({ method, path, body });
      if (method !== "GET" && failNext) {
        const f = failNext;
        failNext = null;
        return json({ code: f.code, message: "Raw English API text" }, f.status);
      }
      if (path === "/admin/home-sections" && method === "GET") return json(list);
      if (path === "/admin/home-sections/reorder" && method === "PUT") {
        const ids = (body as { ids: string[] }).ids;
        list = ids.map((id, i) => ({ ...list.find((s) => s.id === id)!, sortOrder: i + 1 }));
        return new Response(null, { status: 204 });
      }
      const m = /^\/admin\/home-sections\/([^/?]+)$/.exec(path);
      if (m && method === "PATCH") {
        const cur = list.find((s) => s.id === m[1])!;
        const { expectedUpdatedAt: _e, ...rest } = body as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
        const next = { ...cur, ...rest, updatedAt: "2026-11-21T00:00:00.000Z" };
        list = list.map((s) => (s.id === cur.id ? next : s));
        return json(next);
      }
      if (m && method === "DELETE") {
        list = list.filter((s) => s.id !== m[1]);
        return new Response(null, { status: 204 });
      }
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount(path = "/sections/looks") {
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
});
afterEach(() => configureApiClient(null));

const writes = () => calls.filter((c) => c.method !== "GET");
const rows = async () => {
  await screen.findByTestId("looks-list");
  return screen.getAllByTestId("look-row");
};
/** Render the looks page and hand back its rows. */
const show = async () => {
  mount();
  return rows();
};

describe("T-085 · moveAmongLooks (pure)", () => {
  const ids = ["s1", "l1", "s2", "l2"];
  const looks = ["l1", "l2"];
  it("T-085 · moving a look swaps it with the neighbouring look and keeps the other sections in place", () => {
    expect(moveAmongLooks(ids, looks, "l1", 1)).toEqual(["s1", "l2", "s2", "l1"]);
    expect(moveAmongLooks(ids, looks, "l2", -1)).toEqual(["s1", "l2", "s2", "l1"]);
  });
  it("T-085 · a move past either end, or of an unknown id, changes nothing", () => {
    expect(moveAmongLooks(ids, looks, "l1", -1)).toEqual(ids);
    expect(moveAmongLooks(ids, looks, "l2", 1)).toEqual(ids);
    expect(moveAmongLooks(ids, looks, "nope", 1)).toEqual(ids);
  });
  it("T-085 · the full id list always comes back complete (the API rejects anything else)", () => {
    const out = moveAmongLooks(ids, looks, "l1", 1);
    expect([...out].sort()).toEqual([...ids].sort());
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("T-085 · the looks list (%s)", (locale, msgs) => {
  const k = msgs.sections.looks;
  const L = locale as Locale;
  beforeEach(async () => {
    initI18n(L);
    await setLocale(L);
  });

  it("T-085 · lists only the looks, with the photo, the title and how many points", async () => {
    const list_ = await show();
    expect(list_.map((r) => r.getAttribute("data-id"))).toEqual(["l1", "l2"]);
    const first = within(list_[0]);
    expect(first.getByRole("img").getAttribute("src")).toBe("https://cdn.test/room.webp");
    expect(first.getByTestId("look-title").textContent).toBe(base()[1].title[L]);
    // Latin digits in both locales, as everywhere else in the admin (ADR-014 / the invoice work).
    expect(first.getByTestId("look-points").textContent).toBe(`${k.col.points}: 2`);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(k.title);
  });

  it("T-085 · the sections page links here", async () => {
    mount("/sections");
    const manage = await screen.findByTestId("sections-manage-looks");
    expect(manage.textContent).toBe(k.manage);
    expect(manage.getAttribute("href")).toBe("/sections/looks");
  });

  it("T-085 · the page offers a new look", async () => {
    await show();
    expect(screen.getByTestId("look-new").getAttribute("href")).toBe("/sections/looks/new");
    expect(screen.getByTestId("look-new").textContent).toBe(k.new);
  });

  it("T-085 · a look whose product fell out of the catalogue is flagged; a healthy one is not", async () => {
    const list_ = await show();
    expect(within(list_[0]).queryByTestId("look-warning")).toBeNull();
    const warn = within(list_[1]).getByTestId("look-warning");
    expect(warn.textContent).toBe(k.unpublished);
  });

  it("T-085 · the visible toggle saves with the version we loaded", async () => {
    const list_ = await show();
    fireEvent.click(within(list_[0]).getByRole("switch"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: "PATCH",
      path: "/admin/home-sections/l1",
      body: { isVisible: false, expectedUpdatedAt: "2026-11-20T10:00:00.000Z" },
    });
  });

  it("T-085 · moving a look sends every section id, with only the two looks swapped", async () => {
    const list_ = await show();
    fireEvent.click(within(list_[0]).getByTestId("look-move-down"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: "PUT",
      path: "/admin/home-sections/reorder",
      body: { ids: ["s1", "l2", "s2", "l1"] },
    });
    await waitFor(async () => expect((await rows()).map((r) => r.getAttribute("data-id"))).toEqual(["l2", "l1"]));
  });

  it("T-085 · deleting asks first, says it cannot be undone, and only then deletes", async () => {
    const list_ = await show();
    fireEvent.click(within(list_[1]).getByTestId("look-delete"));
    const dialog = await screen.findByTestId("look-delete-dialog");
    expect(within(dialog).getByText(k.delete.title)).toBeTruthy();
    expect(within(dialog).getByText(k.delete.body)).toBeTruthy();
    fireEvent.click(within(dialog).getByTestId("look-delete-cancel"));
    await waitFor(() => expect(screen.queryByTestId("look-delete-dialog")).toBeNull());
    expect(writes()).toHaveLength(0);

    fireEvent.click(within((await rows())[1]).getByTestId("look-delete"));
    fireEvent.click(await screen.findByTestId("look-delete-confirm"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "DELETE", path: "/admin/home-sections/l2" });
    await waitFor(async () => expect(await rows()).toHaveLength(1));
  });

  it("T-085 · a failed delete shows a localized message, never the API text", async () => {
    const list_ = await show();
    fireEvent.click(within(list_[1]).getByTestId("look-delete"));
    failNext = { status: 409, code: "STALE_UPDATE" };
    fireEvent.click(await screen.findByTestId("look-delete-confirm"));
    const error = await screen.findByTestId("look-delete-error");
    expect(error.textContent).toBe(msgs.errors.STALE_UPDATE);
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("T-085 · with no look yet the page says so and still offers a new one", async () => {
    list = base().filter((s) => s.type !== "SHOP_THE_LOOK");
    mount();
    expect((await screen.findByTestId("looks-empty")).textContent).toBe(k.empty);
    expect(screen.getByTestId("look-new")).toBeTruthy();
  });
});
