import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
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

const img = { key: "furnixa/test/2026/11/a.webp", url: "https://cdn.test/a.webp", alt: null, width: null, height: null };
const base = () => [
  { id: "c1", name: { en: "Sofas", ar: "أرائك" }, slug: "sofas", image: img, parentId: null, sortOrder: 1, isActive: true, productCount: 3 },
  { id: "c2", name: { en: "Corner sofas", ar: "أرائك زاوية" }, slug: "corner-sofas", image: null, parentId: "c1", sortOrder: 0, isActive: false, productCount: 0 },
  { id: "c3", name: { en: "Lamps", ar: "مصابيح" }, slug: "lamps", image: null, parentId: null, sortOrder: 2, isActive: true, productCount: 0 },
];

type Call = { method: string; path: string; body: Record<string, unknown> & { image?: unknown } };
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
      if (path.startsWith("/admin/categories")) {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path, body });
        if (method !== "GET" && failNext) {
          const f = failNext;
          failNext = null;
          return json({ code: f.code, message: "Raw English API text" }, f.status);
        }
        if (method === "GET") return json(list);
        if (method === "POST") return json({ id: "c9", ...body, image: null, productCount: 0 }, 201);
        if (method === "PATCH") return json({ ...list[0], ...body });
        if (method === "DELETE") return new Response(null, { status: 204 });
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
        <MemoryRouter initialEntries={["/categories"]}>
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
afterEach(() => configureApiClient(null));

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const writes = () => calls.filter((c) => c.method !== "GET");

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-03 · categories (%s)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
    localStorage.removeItem(THEME_KEY);
    stubApi();
  });
  const n = (c: { name: { en: string; ar: string } }) => c.name[locale];

  it("ADM-03 · lists all categories incl. inactive with parent, product count and both names", async () => {
    mount();
    const rows = await screen.findAllByTestId("category-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain(n(base()[0]));
    expect(rows[0].textContent).toContain("sofas");
    expect(rows[1].textContent).toContain(n(base()[0])); // parent column
    expect(within(rows[1]).getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("heading", { level: 1, name: msgs.categories.title })).toBeTruthy();
  });

  it("ADM-03 · create needs both English and Arabic names and sends the documented body", async () => {
    mount();
    await screen.findByTestId("categories-table");
    fireEvent.click(screen.getByTestId("category-new"));
    type(msgs.categories.form.nameEn, "Chairs");
    expect((screen.getByLabelText(msgs.categories.form.slug) as HTMLInputElement).value).toBe("chairs");
    fireEvent.click(screen.getByRole("button", { name: msgs.common.save }));
    // Arabic name missing: blocked, switched to the Arabic tab, nothing sent.
    expect(await screen.findByText(msgs.categories.form.required)).toBeTruthy();
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain(msgs.common.arabic);
    expect(writes()).toHaveLength(0);
    type(msgs.categories.form.nameAr, "كراسي");
    fireEvent.change(screen.getByLabelText(msgs.categories.form.parent), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: msgs.common.save }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: "POST",
      path: "/admin/categories",
      body: { name: { en: "Chairs", ar: "كراسي" }, slug: "chairs", parentId: "c1", sortOrder: 0, isActive: true },
    });
    expect(writes()[0].body).not.toHaveProperty("image");
    await waitFor(() => expect(screen.queryByTestId("category-dialog")).toBeNull());
  });

  it("ADM-03 · invalid slug is rejected client-side; parent choices are roots only", async () => {
    mount();
    await screen.findByTestId("categories-table");
    fireEvent.click(screen.getByRole("button", { name: msgs.categories.editNamed.replace("{name}", n(base()[0])) }));
    // Editing a root that has children: it cannot become a sub-category.
    expect((screen.getByLabelText(msgs.categories.form.parent) as HTMLSelectElement).disabled).toBe(true);
    type(msgs.categories.form.slug, "Bad Slug");
    fireEvent.click(screen.getByRole("button", { name: msgs.common.save }));
    expect(await screen.findByText(msgs.categories.form.slugInvalid)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("ADM-03 · edit saves with PATCH; removing the image sends image null, otherwise it is not sent", async () => {
    mount();
    await screen.findByTestId("categories-table");
    const editName = msgs.categories.editNamed.replace("{name}", n(base()[0]));
    fireEvent.click(screen.getByRole("button", { name: editName }));
    expect(screen.getByTestId("category-image")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: msgs.common.save }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].method).toBe("PATCH");
    expect(writes()[0].path).toBe("/admin/categories/c1");
    expect(writes()[0].body).not.toHaveProperty("image");
    await waitFor(() => expect(screen.queryByTestId("category-dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: editName }));
    fireEvent.click(screen.getByRole("button", { name: msgs.categories.form.removeImage }));
    fireEvent.click(screen.getByRole("button", { name: msgs.common.save }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body.image).toBeNull();
  });

  it("ADM-03 · active toggle sends only isActive", async () => {
    mount();
    await screen.findByTestId("categories-table");
    fireEvent.click(screen.getByRole("switch", { name: msgs.categories.toggleActive.replace("{name}", n(base()[2])) }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "PATCH", path: "/admin/categories/c3", body: { isActive: false } });
  });

  it("ADM-03 · SLUG_TAKEN is shown localized by code, never the API text, and the form stays open", async () => {
    mount();
    await screen.findByTestId("categories-table");
    fireEvent.click(screen.getByTestId("category-new"));
    type(msgs.categories.form.nameEn, "Lamps");
    type(msgs.categories.form.nameAr, "مصابيح");
    failNext = { status: 409, code: "SLUG_TAKEN" };
    fireEvent.click(screen.getByRole("button", { name: msgs.common.save }));
    const err = await screen.findByTestId("category-form-error");
    expect(err.textContent).toBe(msgs.errors.SLUG_TAKEN);
    expect(err.textContent).not.toContain("Raw English");
    expect(screen.getByTestId("category-dialog")).toBeTruthy();
  });

  it("ADM-03 · delete is not offered for a category with products or sub-categories", async () => {
    mount();
    await screen.findByTestId("categories-table");
    const del = (c: { name: { en: string; ar: string } }) =>
      screen.getByRole("button", { name: msgs.categories.deleteNamed.replace("{name}", n(c)) }) as HTMLButtonElement;
    expect(del(base()[0]).disabled).toBe(true); // 3 products and a child
    expect(del(base()[1]).disabled).toBe(false);
    expect(del(base()[2]).disabled).toBe(false);
  });

  it("ADM-03 · delete asks for confirmation, then sends DELETE", async () => {
    mount();
    await screen.findByTestId("categories-table");
    fireEvent.click(screen.getByRole("button", { name: msgs.categories.deleteNamed.replace("{name}", n(base()[2])) }));
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("category-delete-confirm"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "DELETE", path: "/admin/categories/c3" });
    await waitFor(() => expect(screen.queryByTestId("category-delete-dialog")).toBeNull());
  });

  it("ADM-03 · 409 CATEGORY_HAS_PRODUCTS and CATEGORY_HAS_CHILDREN (stale list) show localized messages", async () => {
    mount();
    await screen.findByTestId("categories-table");
    const open = () =>
      fireEvent.click(screen.getByRole("button", { name: msgs.categories.deleteNamed.replace("{name}", n(base()[2])) }));
    open();
    failNext = { status: 409, code: "CATEGORY_HAS_PRODUCTS" };
    fireEvent.click(screen.getByTestId("category-delete-confirm"));
    expect((await screen.findByTestId("category-delete-error")).textContent).toBe(msgs.errors.CATEGORY_HAS_PRODUCTS);
    failNext = { status: 409, code: "CATEGORY_HAS_CHILDREN" };
    fireEvent.click(screen.getByTestId("category-delete-confirm"));
    await waitFor(() =>
      expect(screen.getByTestId("category-delete-error").textContent).toBe(msgs.errors.CATEGORY_HAS_CHILDREN),
    );
  });

  it("ADM-03 · dark mode renders the page with token classes only", async () => {
    document.documentElement.classList.add("dark");
    mount();
    const table = await screen.findByTestId("categories-table");
    expect(table.parentElement?.className).toContain("bg-card");
  });
});

describe("ADM-03 · locale files", () => {
  it("ADM-03 · en and ar define every categories key and the new error codes", () => {
    const keys = (o: unknown, p = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "object" && v ? keys(v, `${p}${k}.`) : [`${p}${k}`],
      );
    expect(keys(ar.categories).sort()).toEqual(keys(en.categories).sort());
    for (const c of ["SLUG_TAKEN", "CATEGORY_HAS_PRODUCTS", "CATEGORY_HAS_CHILDREN"]) {
      expect((en.errors as unknown as Record<string, string>)[c]).toBeTruthy();
      expect((ar.errors as unknown as Record<string, string>)[c]).toBeTruthy();
    }
  });
});
