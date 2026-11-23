import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { moveItem } from "@/lib/sections";
import { THEME_KEY, ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

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

const mk = (id: string, type: string, en_: string, ar_: string, sortOrder: number, extra: object = {}) => ({
  id,
  type,
  title: { en: en_, ar: ar_ },
  subtitle: null,
  config: null,
  sortOrder,
  isVisible: true,
  updatedAt: "2026-11-20T10:00:00.000Z",
  ...extra,
});
const base = () => [
  mk("s1", "CATEGORY_GRID", "Shop by room", "تسوق حسب الغرفة", 0),
  mk("s2", "FEATURED_PRODUCTS", "Featured", "مميز", 1, { config: { productIds: ["p1"], limit: 6 } }),
  mk("s3", "TESTIMONIALS", "Reviews", "آراء", 2, { isVisible: false }),
];

type Call = { method: string; path: string; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
let calls: Call[] = [];
let list = base();
let failNext: { status: number; code: string; method?: string } | null = null;

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
      if (method !== "GET" && failNext && (!failNext.method || failNext.method === method)) {
        const f = failNext;
        failNext = null;
        return json({ code: f.code, message: "Raw English API text" }, f.status);
      }
      if (path === "/admin/home-sections" && method === "GET") return json(list);
      if (path === "/admin/home-sections/reorder" && method === "PUT") {
        const ids = body.ids as string[];
        list = ids.map((id, i) => ({ ...list.find((s) => s.id === id)!, sortOrder: i, updatedAt: "2026-11-21T00:00:00.000Z" }));
        return new Response(null, { status: 204 });
      }
      const m = /^\/admin\/home-sections\/([^/?]+)$/.exec(path);
      if (m && method === "PATCH") {
        const cur = list.find((s) => s.id === m[1])!;
        const { expectedUpdatedAt: _e, ...rest } = body; // eslint-disable-line @typescript-eslint/no-unused-vars
        const next = { ...cur, ...rest, updatedAt: "2026-11-21T00:00:00.000Z" };
        list = list.map((s) => (s.id === cur.id ? next : s));
        return json(next);
      }
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount() {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/sections"]}>
          <App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  authStore.clear();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(() => {
  configureApiClient(null);
  vi.unstubAllGlobals();
});

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const writes = () => calls.filter((c) => c.method !== "GET");
const order = () => screen.getAllByTestId("section-row").map((r) => r.getAttribute("data-id"));

describe("ADM-07 · moveItem", () => {
  it("ADM-07 · moves one item and keeps the rest in order; out-of-range is a no-op", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 0, 3)).toEqual(["a", "b", "c"]);
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-07 · home sections (%s)", (locale, msgs) => {
  const s = msgs.sections;
  const L = locale as Locale;
  const name = (i: number) => base()[i].title[L];
  beforeEach(async () => {
    initI18n(L);
    await setLocale(L);
    localStorage.removeItem(THEME_KEY);
    stubApi();
  });

  it("ADM-07 · lists sections by sort order with both titles, type, visibility and a drag handle each", async () => {
    mount();
    const rows = await screen.findAllByTestId("section-row");
    expect(order()).toEqual(["s1", "s2", "s3"]);
    expect(rows[0].textContent).toContain(base()[0].title[L]);
    expect(rows[0].textContent).toContain(base()[0].title[L === "en" ? "ar" : "en"]);
    expect(rows[0].textContent).toContain(s.type.CATEGORY_GRID);
    expect(within(rows[0]).getByTestId("section-visibility").textContent).toBe(s.visible);
    expect(within(rows[2]).getByTestId("section-visibility").textContent).toBe(s.hidden);
    for (const r of rows) expect(within(r).getByTestId("section-handle")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: s.title })).toBeTruthy();
  });

  it("ADM-07 · keyboard alternative: move buttons reorder and PUT exactly the full id list", async () => {
    mount();
    await screen.findByTestId("sections-list");
    // First cannot go up, last cannot go down.
    expect((screen.getByRole("button", { name: s.moveUp.replace("{name}", name(0)) }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: s.moveDown.replace("{name}", name(2)) }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: s.moveDown.replace("{name}", name(0)) }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].method).toBe("PUT");
    expect(writes()[0].path).toBe("/admin/home-sections/reorder");
    expect(writes()[0].body).toEqual({ ids: ["s2", "s1", "s3"] });
    await waitFor(() => expect(order()).toEqual(["s2", "s1", "s3"]));
    const live = screen.getByTestId("sections-announce").textContent ?? "";
    expect(live).toContain(name(0));
    // Move the last one up.
    fireEvent.click(screen.getByRole("button", { name: s.moveUp.replace("{name}", name(2)) }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toEqual({ ids: ["s2", "s3", "s1"] });
  });

  it("ADM-07 · a failed reorder rolls the list back and shows the localized error, not the API text", async () => {
    mount();
    await screen.findByTestId("sections-list");
    failNext = { status: 422, code: "VALIDATION_ERROR", method: "PUT" };
    fireEvent.click(screen.getByRole("button", { name: s.moveDown.replace("{name}", name(0)) }));
    const err = await screen.findByTestId("sections-row-error");
    expect(err.textContent).toBe(msgs.errors.VALIDATION_ERROR ?? msgs.errors.generic);
    expect(document.body.textContent).not.toContain("Raw English API text");
    await waitFor(() => expect(order()).toEqual(["s1", "s2", "s3"]));
  });

  it("ADM-07 · drag handles are focusable keyboard sensors (dnd-kit attributes)", async () => {
    mount();
    await screen.findByTestId("sections-list");
    const h = screen.getAllByTestId("section-handle")[0];
    expect(h.getAttribute("aria-label")).toBe(s.dragHandle.replace("{name}", name(0)));
    expect(h.getAttribute("role")).toBe("button");
    expect(h.getAttribute("tabindex")).toBe("0");
    expect(h.getAttribute("aria-roledescription")).toBeTruthy();
  });

  it("ADM-07 · visibility switch PATCHes isVisible with expectedUpdatedAt", async () => {
    mount();
    await screen.findByTestId("sections-list");
    fireEvent.click(screen.getByRole("switch", { name: s.toggleVisible.replace("{name}", name(2)) }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].method).toBe("PATCH");
    expect(writes()[0].path).toBe("/admin/home-sections/s3");
    expect(writes()[0].body).toEqual({ isVisible: true, expectedUpdatedAt: "2026-11-20T10:00:00.000Z" });
    await waitFor(() =>
      expect(within(screen.getAllByTestId("section-row")[2]).getByTestId("section-visibility").textContent).toBe(s.visible),
    );
  });

  it("ADM-07 · edit needs both titles; subtitle is both languages or none; limit 1-24", async () => {
    mount();
    await screen.findByTestId("sections-list");
    fireEvent.click(screen.getByRole("button", { name: s.editNamed.replace("{name}", name(1)) }));
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${msgs.common.english}`) }));
    fill(s.form.titleEn, "");
    fill(s.form.subtitleEn, "Only English");
    fill(s.form.limit, "25");
    fireEvent.click(screen.getByTestId("section-save"));
    expect((await screen.findAllByText(s.form.required)).length).toBeGreaterThan(0);
    expect(screen.getByText(s.form.limitInvalid)).toBeTruthy();
    expect(writes()).toHaveLength(0);
    fill(s.form.limit, "0");
    fireEvent.click(screen.getByTestId("section-save"));
    expect(await screen.findByText(s.form.limitInvalid)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("ADM-07 · edit PATCHes titles, subtitle, visibility and the merged config with expectedUpdatedAt", async () => {
    mount();
    await screen.findByTestId("sections-list");
    fireEvent.click(screen.getByRole("button", { name: s.editNamed.replace("{name}", name(1)) }));
    expect(screen.getByTestId("section-dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${msgs.common.english}`) }));
    fill(s.form.titleEn, "Best sellers");
    fill(s.form.subtitleEn, "Hand-picked");
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${msgs.common.arabic}`) }));
    fill(s.form.subtitleAr, "مختارة بعناية");
    fill(s.form.limit, "12");
    fireEvent.click(screen.getByTestId("section-save"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].method).toBe("PATCH");
    expect(writes()[0].body).toEqual({
      title: { en: "Best sellers", ar: "مميز" },
      subtitle: { en: "Hand-picked", ar: "مختارة بعناية" },
      isVisible: true,
      config: { productIds: ["p1"], limit: 12 },
      expectedUpdatedAt: "2026-11-20T10:00:00.000Z",
    });
    await waitFor(() => expect(screen.queryByTestId("section-dialog")).toBeNull());
  });

  it("ADM-07 · an unchanged limit leaves config out; non-product sections show no limit field", async () => {
    mount();
    await screen.findByTestId("sections-list");
    fireEvent.click(screen.getByRole("button", { name: s.editNamed.replace("{name}", name(0)) }));
    expect(screen.queryByLabelText(s.form.limit)).toBeNull();
    fireEvent.click(screen.getByTestId("section-save"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body.config).toBeUndefined();
    expect(writes()[0].body.subtitle).toBeNull();
  });

  it("ADM-07 · 409 STALE_UPDATE shows the reload notice, keeps the edits, then reload picks up the latest", async () => {
    mount();
    await screen.findByTestId("sections-list");
    fireEvent.click(screen.getByRole("button", { name: s.editNamed.replace("{name}", name(0)) }));
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${msgs.common.english}`) }));
    fill(s.form.titleEn, "My edit");
    failNext = { status: 409, code: "STALE_UPDATE", method: "PATCH" };
    fireEvent.click(screen.getByTestId("section-save"));
    const stale = await screen.findByTestId("section-stale");
    expect(stale.textContent).toContain(s.form.stale);
    expect((screen.getByLabelText(s.form.titleEn) as HTMLInputElement).value).toBe("My edit");
    list = list.map((x) => (x.id === "s1" ? { ...x, title: { en: "Server copy", ar: x.title.ar }, updatedAt: "2026-11-22T00:00:00.000Z" } : x));
    fireEvent.click(within(stale).getByRole("button", { name: s.form.reload }));
    await waitFor(() => expect((screen.getByLabelText(s.form.titleEn) as HTMLInputElement).value).toBe("Server copy"));
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("ADM-07 · reads RTL/LTR correctly and works in dark mode", async () => {
    document.documentElement.classList.add("dark");
    mount();
    await screen.findByTestId("sections-list");
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    // Dark mode comes from the token classes only; no hard-coded colours on the rows.
    expect(screen.getAllByTestId("section-row")[0].className).toContain("bg-card");
  });

  it("ADM-07 · no create or delete controls (not specified in the docs, B-032)", async () => {
    mount();
    await screen.findByTestId("sections-list");
    expect(screen.queryByRole("button", { name: new RegExp(msgs.common.delete) })).toBeNull();
  });
});
