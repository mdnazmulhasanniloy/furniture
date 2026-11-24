import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { formatPrice } from "@/lib/format";
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

const UPDATED = "2026-11-20T10:00:00.000Z";
const imgA = { key: "furnixa/test/2026/11/a.webp", url: "https://cdn.test/a.webp", alt: { en: "Front", ar: "أمامي" }, width: null, height: null };
const imgB = { key: "furnixa/test/2026/11/b.webp", url: "https://cdn.test/b.webp", alt: null, width: null, height: null };
const baseProducts = () => [
  {
    id: "p1", title: { en: "Oak table", ar: "طاولة بلوط" }, description: { en: "Solid oak", ar: "بلوط صلب" }, slug: "oak-table",
    sku: "OAK-1", type: "NEW", condition: "NEW", conditionNotes: null, price: 129900, compareAtPrice: 159900, stock: 1,
    categoryId: "c1", images: [imgA, imgB], dimensions: { widthCm: 120 }, material: "Oak", color: null, isFeatured: true,
    status: "PUBLISHED", createdAt: UPDATED, updatedAt: UPDATED,
  },
  {
    id: "p2", title: { en: "", ar: "كرسي مستعمل" }, description: { en: "", ar: "وصف" }, slug: "used-chair",
    sku: null, type: "RESALE", condition: "LIKE_NEW", conditionNotes: null, price: 25050, compareAtPrice: null, stock: 10,
    categoryId: "c1", images: [], dimensions: null, material: null, color: null, isFeatured: false,
    status: "DRAFT", createdAt: UPDATED, updatedAt: UPDATED,
  },
];
const cats = [
  { id: "c1", name: { en: "Sofas", ar: "أرائك" }, slug: "sofas", image: null, parentId: null, sortOrder: 1, isActive: true, productCount: 2 },
  { id: "c3", name: { en: "Lamps", ar: "مصابيح" }, slug: "lamps", image: null, parentId: null, sortOrder: 2, isActive: true, productCount: 0 },
  // Child of c1, appended so the indexes above stay stable (QA A2 uses it).
  { id: "c2", name: { en: "Armchairs", ar: "كراسي" }, slug: "armchairs", image: null, parentId: "c1", sortOrder: 1, isActive: true, productCount: 1 },
];
const child = cats[2];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- request bodies are asserted field by field
type Call = { method: string; path: string; body: Record<string, any> };
let calls: Call[] = [];
let products = baseProducts();
let failNext: { status: number; code: string; match?: string } | null = null;
let totalPages = 1;

function stubApi() {
  calls = [];
  products = baseProducts();
  failNext = null;
  totalPages = 1;
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh") return json({ accessToken: "at-1", user: adminUser });
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path.startsWith("/admin/")) calls.push({ method, path, body });
      if (method !== "GET" && failNext && (!failNext.match || path.includes(failNext.match))) {
        const f = failNext;
        failNext = null;
        return json({ code: f.code, message: "Raw English API text" }, f.status);
      }
      if (path === "/admin/categories") return json(cats);
      if (path.startsWith("/admin/categories/") && method === "PATCH") return json({ ...cats[1], ...body });
      if (path === "/admin/uploads/presign") {
        return json({
          uploadUrl: "https://r2.test/secret-presigned-put?sig=SECRET",
          key: `furnixa/test/2026/11/new-${calls.filter((c) => c.path.includes("presign")).length}.webp`,
          publicUrl: "https://cdn.test/new.webp",
          expiresIn: 300,
        });
      }
      if (path.startsWith("/admin/products?")) {
        return json({ items: products, meta: { page: 1, limit: 20, total: products.length, totalPages } });
      }
      if (path === "/admin/products" && method === "POST") return json({ ...products[0], ...body, id: "p9" }, 201);
      const m = /^\/admin\/products\/([^/?]+)$/.exec(path);
      if (m) {
        const cur = products.find((p) => p.id === m[1]);
        if (!cur) return json({ code: "NOT_FOUND" }, 404);
        if (method === "GET") return json(cur);
        if (method === "PATCH") {
          const next = { ...cur, ...body, updatedAt: "2026-11-21T00:00:00.000Z" };
          products = products.map((x) => (x.id === cur.id ? next : x)); // like the API: the list sees the save
          return json(next);
        }
        if (method === "DELETE") return new Response(null, { status: 204 });
      }
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

// Fake XMLHttpRequest: no network, records the PUT to the presigned URL.
type Put = { method: string; url: string; headers: Record<string, string>; body: unknown };
let puts: Put[] = [];
let putMode: "ok" | "fail" = "ok";
class FakeXHR {
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  private rec: Put = { method: "", url: "", headers: {}, body: null };
  open(method: string, url: string) {
    this.rec.method = method;
    this.rec.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.rec.headers[k] = v;
  }
  send(body: unknown) {
    this.rec.body = body;
    puts.push(this.rec);
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      if (putMode === "ok") {
        this.status = 200;
        this.onload?.();
      } else this.onerror?.();
    }, 0);
  }
}

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
  authStore.clear();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  puts = [];
  putMode = "ok";
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});
afterEach(() => {
  configureApiClient(null);
  vi.unstubAllGlobals();
});

const file = (name: string, type: string, size = 10) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};
const writes = () => calls.filter((c) => c.method !== "GET" && !c.path.includes("presign"));
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-02 · products (%s)", (locale, msgs) => {
  const p = msgs.products;
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
    localStorage.removeItem(THEME_KEY);
    stubApi();
  });
  const L = locale as Locale;
  const save = () => fireEvent.click(screen.getByTestId("product-save"));
  const upload = (...files: File[]) =>
    fireEvent.change(screen.getByTestId("product-images-input"), { target: { files } });
  async function fillMinimal() {
    await screen.findByTestId("product-save");
    fireEvent.click(screen.getByRole("tab", { name: msgs.common.arabic }));
    fill(p.form.titleAr, "طاولة");
    fill(p.form.descAr, "وصف");
    fill(p.form.slug, "table");
    await screen.findByRole("option", { name: cats[0].name[L] });
    fill(p.form.category, "c1");
  }

  it("ADM-02 · the list shows name (active locale), type, exact price, stock and status; empty images show a placeholder", async () => {
    mount("/products");
    const rows = await screen.findAllByTestId("product-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain(baseProducts()[0].title[L]);
    expect(within(rows[0]).getByTestId("product-price").textContent).toBe(formatPrice(129900, L));
    expect(rows[0].textContent).toContain(formatPrice(159900, L)); // compare-at
    expect(within(rows[1]).getByTestId("product-price").textContent).toBe(formatPrice(25050, L));
    expect(rows[0].textContent).toContain(p.status.PUBLISHED);
    expect(rows[1].textContent).toContain(p.status.DRAFT);
    expect(rows[1].textContent).toContain(p.type.RESALE);
    expect(within(rows[0]).queryByTestId("product-placeholder")).toBeNull();
    expect(within(rows[1]).getByTestId("product-placeholder")).toBeTruthy();
    // stock <= 2 is flagged, stock 10 is not (screen-specs A-02)
    expect(within(rows[0]).getByTestId("product-stock").getAttribute("data-low")).toBe("true");
    expect(within(rows[1]).getByTestId("product-stock").getAttribute("data-low")).toBe("false");
    expect(screen.getByRole("heading", { level: 1, name: p.title })).toBeTruthy();
  });

  it("I18N-02 · a missing locale falls back to Arabic in the list", async () => {
    mount("/products");
    const rows = await screen.findAllByTestId("product-row");
    expect(rows[1].textContent).toContain("كرسي مستعمل"); // en title is empty -> ar text
  });

  it("ADM-02 · search, status and type filters and pagination are sent to the API", async () => {
    totalPages = 3;
    mount("/products");
    await screen.findAllByTestId("product-row");
    fill(p.search, "oak");
    fireEvent.click(screen.getByRole("button", { name: p.searchButton }));
    await waitFor(() => expect(calls.some((c) => c.path.includes("q=oak"))).toBe(true));
    fill(p.filterStatus, "PUBLISHED");
    await waitFor(() => expect(calls.some((c) => c.path.includes("status=PUBLISHED"))).toBe(true));
    fill(p.filterType, "RESALE");
    await waitFor(() => expect(calls.some((c) => c.path.includes("type=RESALE"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: p.next }));
    await waitFor(() => expect(calls.some((c) => c.path.includes("page=2"))).toBe(true));
  });

  it("ADM-02 · delete asks for confirmation, then calls DELETE and explains archive-if-ordered", async () => {
    mount("/products");
    await screen.findAllByTestId("product-row");
    fireEvent.click(screen.getByRole("button", { name: p.deleteNamed.replace("{name}", baseProducts()[0].title[L]) }));
    const dlg = screen.getByTestId("product-delete-dialog");
    expect(dlg.textContent).toContain(p.deleteBody.replace("{name}", baseProducts()[0].title[L]));
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("product-delete-confirm"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "DELETE", path: "/admin/products/p1" });
  });

  it("I18N-02 · publishing needs title and description in both languages; nothing is sent until then", async () => {
    mount("/products/new");
    await fillMinimal();
    fill(p.form.status, "PUBLISHED");
    save();
    expect((await screen.findAllByText(p.form.publishNeedsBoth)).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain(msgs.common.english);
    expect(writes()).toHaveLength(0);
    fill(p.form.titleEn, "Table");
    fill(p.form.descEn, "Desc");
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: "POST",
      path: "/admin/products",
      body: { status: "PUBLISHED", title: { en: "Table", ar: "طاولة" }, description: { en: "Desc", ar: "وصف" } },
    });
  });

  it("I18N-02 · a draft needs at least one language and may have only one", async () => {
    mount("/products/new");
    await screen.findByTestId("product-save");
    fill(p.form.slug, "x");
    await screen.findByRole("option", { name: cats[0].name[L] });
    fill(p.form.category, "c1");
    save();
    expect((await screen.findAllByText(p.form.needOne)).length).toBe(2); // title + description
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(msgs.common.arabic) }));
    fill(p.form.titleAr, "عنوان");
    fill(p.form.descAr, "وصف");
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body.title).toEqual({ en: "", ar: "عنوان" });
    expect(writes()[0].body.status).toBe("DRAFT");
  });

  // QA 2026-11-24 (A3, closes B-031): money inputs take SAR with at most 2 decimals, not halalas.
  it("ADM-02 · create converts the typed SAR amounts to exact halalas and sends nulls for empty optionals", async () => {
    mount("/products/new");
    await fillMinimal();
    fill(p.form.price, "1299");
    expect(screen.getByLabelText(p.form.price).parentElement!.textContent).toContain(formatPrice(129900, L));
    fill(p.form.compareAt, "1599.50");
    fill(p.form.stock, "7");
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({
      price: 129900, compareAtPrice: 159950, stock: 7, type: "NEW", condition: "NEW", sku: null,
      dimensions: null, material: null, color: null, conditionNotes: null, images: [], isFeatured: false, categoryId: "c1",
    });
    expect(writes()[0].body).not.toHaveProperty("expectedUpdatedAt");
  });

  it.each([
    ["150", 15000],
    ["150.5", 15050],
    ["150.50", 15050],
    ["0.01", 1],
    ["1,250.50", 125050],
  ])("ADM-02 · the price %s SAR is sent as %i halalas (A3)", async (typed, halalas) => {
    mount("/products/new");
    await fillMinimal();
    fill(p.form.price, typed);
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body.price).toBe(halalas);
  });

  it.each([
    ["abc", "amountInvalid"],
    ["150.005", "amountInvalid"],
    ["-150", "amountNegative"],
    ["", "amountInvalid"],
  ] as const)("ADM-02 · the price %s is rejected before sending (A3)", async (typed, key) => {
    mount("/products/new");
    await fillMinimal();
    fill(p.form.price, typed);
    save();
    expect((await screen.findAllByText(p.form[key])).length).toBeGreaterThanOrEqual(1);
    expect(writes()).toHaveLength(0);
  });

  it("ADM-02 · invalid money, stock and compare-at are rejected before sending", async () => {
    mount("/products/new");
    await fillMinimal();
    fill(p.form.price, "1000");
    fill(p.form.compareAt, "1000");
    fill(p.form.stock, "100001");
    save();
    expect(await screen.findByText(p.form.compareHigher)).toBeTruthy();
    expect(screen.getByText(p.form.tooBig)).toBeTruthy();
    fill(p.form.price, "12.345");
    save();
    expect((await screen.findAllByText(p.form.amountInvalid)).length).toBeGreaterThanOrEqual(1);
    expect(writes()).toHaveLength(0);
  });

  it("ADM-02 · the editor shows SAR back after loading and after a save (A3)", async () => {
    mount("/products/p1");
    await screen.findByRole("heading", { level: 1, name: p.editor.titleEdit });
    const price = () => screen.getByLabelText(p.form.price) as HTMLInputElement;
    await waitFor(() => expect(price().value).toBe("1299")); // 129900 halalas
    expect((screen.getByLabelText(p.form.compareAt) as HTMLInputElement).value).toBe("1599");
    fill(p.form.price, "1250.50");
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body.price).toBe(125050);
    // back on the list the saved amount reads as SAR, not as halalas
    await screen.findByTestId("products-table");
    await waitFor(() =>
      expect(within(screen.getAllByTestId("product-row")[0]).getByTestId("product-price").textContent).toBe(formatPrice(125050, L)),
    );
  });

  it("ADM-02 · type and condition stay consistent (NEW only with NEW; RESALE with Like new, Good or Fair)", async () => {
    mount("/products/new");
    await screen.findByTestId("product-save");
    const cond = () =>
      Array.from((screen.getByLabelText(p.form.condition) as HTMLSelectElement).options).map((o) => o.value);
    expect(cond()).toEqual(["NEW"]);
    fill(p.form.type, "RESALE");
    expect(cond()).toEqual(["LIKE_NEW", "GOOD", "FAIR"]);
    expect((screen.getByLabelText(p.form.condition) as HTMLSelectElement).value).toBe("LIKE_NEW");
    fill(p.form.type, "NEW");
    expect(cond()).toEqual(["NEW"]);
  });

  it("ADM-02 · edit loads the product, PATCH sends expectedUpdatedAt and only {key, alt} per image", async () => {
    mount("/products/p1");
    await screen.findByRole("heading", { level: 1, name: p.editor.titleEdit });
    await waitFor(() => expect((screen.getByLabelText(p.form.stock) as HTMLInputElement).value).toBe("1"));
    expect((screen.getByLabelText(p.form.price) as HTMLInputElement).value).toBe("1299"); // SAR since A3
    expect((screen.getByLabelText(p.form.widthCm) as HTMLInputElement).value).toBe("120");
    fill(p.form.stock, "5");
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    const w = writes()[0];
    expect(w).toMatchObject({ method: "PATCH", path: "/admin/products/p1" });
    expect(w.body.expectedUpdatedAt).toBe(UPDATED);
    expect(w.body.stock).toBe(5);
    expect(w.body.images).toEqual([{ key: imgA.key, alt: imgA.alt }, { key: imgB.key }]);
    await screen.findByTestId("products-table"); // returns to the list after saving
  });

  /**
   * QA 2026-11-24 (A2). The category `<select>` is registered while the categories query is still in
   * flight, so the product's id was applied to a select that had no matching `<option>` yet and the
   * element fell back to the placeholder. The admin saw no category, and because react-hook-form reads
   * a select back from the DOM on blur, merely opening and leaving the field turned the kept value into
   * "" - the reported "This field is required" on save. Asserted on a product in a child category.
   */
  it("ADM-02 · edit pre-selects the product's category once the options load, child categories included (A2)", async () => {
    products[0] = { ...products[0], categoryId: child.id };
    mount("/products/p1");
    await screen.findByRole("heading", { level: 1, name: p.editor.titleEdit });
    await screen.findByRole("option", { name: `— ${child.name[L]}` }); // options arrive after the mount
    const select = () => screen.getByLabelText(p.form.category) as HTMLSelectElement;
    await waitFor(() => expect(select().value).toBe(child.id));
    fireEvent.blur(select()); // the field the admin opened and left without choosing
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body.categoryId).toBe(child.id);
    expect(document.body.textContent).not.toContain(p.form.required);
  });

  it("ADM-02 · the category select keeps an edit made before the options loaded (A2)", async () => {
    mount("/products/p1");
    await screen.findByTestId("product-save");
    fill(p.form.stock, "7"); // typed while /admin/categories is still in flight
    await screen.findByRole("option", { name: `— ${child.name[L]}` });
    expect((screen.getByLabelText(p.form.stock) as HTMLInputElement).value).toBe("7");
    fill(p.form.category, child.id);
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({ stock: 7, categoryId: child.id });
  });

  it("ADM-02 · 409 STALE_UPDATE shows the reload message by code, keeps the edits, and reload fetches the latest", async () => {
    mount("/products/p1");
    await waitFor(() => expect((screen.getByLabelText(p.form.stock) as HTMLInputElement).value).toBe("1"));
    fill(p.form.stock, "5");
    failNext = { status: 409, code: "STALE_UPDATE" };
    save();
    const box = await screen.findByTestId("product-stale");
    expect(box.textContent).toContain(p.editor.stale);
    expect(document.body.textContent).not.toContain("Raw English API text");
    expect((screen.getByLabelText(p.form.stock) as HTMLInputElement).value).toBe("5"); // edits kept
    products[0] = { ...products[0], stock: 42, updatedAt: "2026-11-22T00:00:00.000Z" };
    fireEvent.click(screen.getByRole("button", { name: p.editor.reload }));
    await waitFor(() => expect((screen.getByLabelText(p.form.stock) as HTMLInputElement).value).toBe("42"));
    expect(screen.queryByTestId("product-stale")).toBeNull();
    save();
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body.expectedUpdatedAt).toBe("2026-11-22T00:00:00.000Z");
  });

  it("ADM-02 · other API errors are shown localized by code, never the API text", async () => {
    mount("/products/p1");
    await waitFor(() => expect((screen.getByLabelText(p.form.stock) as HTMLInputElement).value).toBe("1"));
    fill(p.form.stock, "2");
    failNext = { status: 409, code: "SLUG_TAKEN" };
    save();
    const err = await screen.findByTestId("product-form-error");
    expect(err.textContent).toBe(msgs.errors.SLUG_TAKEN);
  });

  it("ADM-02 · unsaved-changes guard: leaving with edits asks first; a clean form leaves at once", async () => {
    mount("/products/p1");
    await waitFor(() => expect((screen.getByLabelText(p.form.stock) as HTMLInputElement).value).toBe("1"));
    const link = () => screen.getAllByRole("link", { name: msgs.nav.categories })[0];
    fill(p.form.stock, "9");
    fireEvent.click(link());
    expect(screen.getByTestId("unsaved-dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: p.editor.stay }));
    expect(screen.queryByTestId("unsaved-dialog")).toBeNull();
    expect((screen.getByLabelText(p.form.stock) as HTMLInputElement).value).toBe("9");
    fireEvent.click(link());
    fireEvent.click(screen.getByTestId("unsaved-leave"));
    expect(await screen.findByRole("heading", { level: 1, name: msgs.categories.title })).toBeTruthy();
  });

  it("ADM-02 · a form with no changes does not trigger the guard", async () => {
    mount("/products/p1");
    await waitFor(() => expect((screen.getByLabelText(p.form.stock) as HTMLInputElement).value).toBe("1"));
    fireEvent.click(screen.getAllByRole("link", { name: msgs.nav.categories })[0]);
    expect(await screen.findByRole("heading", { level: 1, name: msgs.categories.title })).toBeTruthy();
    expect(screen.queryByTestId("unsaved-dialog")).toBeNull();
  });

  it("ADM-02 · uploader rejects wrong type and over 5 MB before presigning; exactly 5 MB is accepted", async () => {
    mount("/products/new");
    await screen.findByTestId("product-save");
    upload(file("a.gif", "image/gif"));
    expect(screen.getByTestId("uploader-notice").textContent).toBe(msgs.uploader.err.type.replace("{name}", "a.gif"));
    upload(file("big.png", "image/png", 5_242_881));
    expect(screen.getByTestId("uploader-notice").textContent).toBe(msgs.uploader.err.size.replace("{name}", "big.png"));
    expect(calls.filter((c) => c.path.includes("presign"))).toHaveLength(0);
    expect(puts).toHaveLength(0);
    upload(file("ok.png", "image/png", 5_242_880));
    await waitFor(() => expect(screen.getByTestId("uploader-item").getAttribute("data-status")).toBe("done"));
  });

  it("ADM-02 · upload presigns, PUTs to the signed URL with the same Content-Type, and saves only the key", async () => {
    mount("/products/new");
    await fillMinimal();
    upload(file("sofa.webp", "image/webp", 1234));
    await waitFor(() => expect(screen.getByTestId("uploader-item").getAttribute("data-status")).toBe("done"));
    const presign = calls.find((c) => c.path === "/admin/uploads/presign")!;
    expect(presign.body).toEqual({ fileName: "sofa.webp", contentType: "image/webp", size: 1234 });
    expect(puts).toHaveLength(1);
    expect(puts[0].method).toBe("PUT");
    expect(puts[0].url).toContain("r2.test");
    expect(puts[0].headers).toEqual({ "Content-Type": "image/webp" }); // no Authorization header to R2
    expect(document.body.textContent).not.toContain("secret-presigned-put");
    fill(msgs.uploader.altEnN.replace("{n}", "1"), "Sofa");
    fill(msgs.uploader.altArN.replace("{n}", "1"), "أريكة");
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    const img = writes()[0].body.images;
    expect(img).toHaveLength(1);
    expect(img[0]).toEqual({ key: "furnixa/test/2026/11/new-1.webp", alt: { en: "Sofa", ar: "أريكة" } });
    expect(JSON.stringify(writes()[0].body)).not.toContain("secret");
  });

  it("ADM-02 · a failed PUT shows an error state and the failed image is not saved", async () => {
    putMode = "fail";
    mount("/products/new");
    await fillMinimal();
    upload(file("a.png", "image/png"));
    const item = await screen.findByTestId("uploader-item");
    await waitFor(() => expect(item.getAttribute("data-status")).toBe("error"));
    expect(screen.getByTestId("uploader-error").textContent).toBe(msgs.uploader.err.failed);
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body.images).toEqual([]);
  });

  it("ADM-02 · a presign error is shown localized by code", async () => {
    mount("/products/new");
    await screen.findByTestId("product-save");
    failNext = { status: 422, code: "UPLOAD_NOT_ALLOWED", match: "presign" };
    upload(file("a.png", "image/png"));
    const item = await screen.findByTestId("uploader-item");
    await waitFor(() => expect(item.getAttribute("data-status")).toBe("error"));
    expect(screen.getByTestId("uploader-error").textContent).toBe(msgs.errors.UPLOAD_NOT_ALLOWED);
    expect(puts).toHaveLength(0);
  });

  it("ADM-02 · at most 8 images", async () => {
    mount("/products/new");
    await screen.findByTestId("product-save");
    upload(...Array.from({ length: 9 }, (_, i) => file(`f${i}.png`, "image/png")));
    expect(screen.getByTestId("uploader-notice").textContent).toBe(msgs.uploader.err.max.replace("{max}", "8"));
    await waitFor(() => expect(screen.getAllByTestId("uploader-item")).toHaveLength(8));
  });

  it("ADM-02 · reordering changes the saved order; removing an image only drops it from the form until save", async () => {
    mount("/products/p1");
    await waitFor(() => expect(screen.getAllByTestId("uploader-item")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: msgs.uploader.moveLater.replace("{n}", "1") }));
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body.images.map((i: { key: string }) => i.key)).toEqual([imgB.key, imgA.key]);
  });

  it("ADM-02 · removing an image sends nothing until save, then the saved list omits it", async () => {
    mount("/products/p1");
    await waitFor(() => expect(screen.getAllByTestId("uploader-item")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: msgs.uploader.remove.replace("{n}", "2") }));
    expect(screen.getAllByTestId("uploader-item")).toHaveLength(1);
    expect(writes()).toHaveLength(0);
    save();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body.images).toEqual([{ key: imgA.key, alt: imgA.alt }]);
  });

  it("ADM-02 · alt text must be filled in both languages or neither", async () => {
    mount("/products/p1");
    await waitFor(() => expect(screen.getAllByTestId("uploader-item")).toHaveLength(2));
    fill(msgs.uploader.altEnN.replace("{n}", "2"), "Side");
    expect(screen.getByTestId("uploader-alt-error").textContent).toBe(msgs.uploader.altBoth);
    save();
    expect((await screen.findByTestId("product-form-error")).textContent).toBe(p.form.altIncomplete);
    expect(writes()).toHaveLength(0);
  });

  it("ADM-02 · saving is blocked while an upload is in flight", async () => {
    mount("/products/new");
    await fillMinimal();
    // never finishes
    putMode = "ok";
    const orig = FakeXHR.prototype.send;
    FakeXHR.prototype.send = function () {};
    try {
      upload(file("a.png", "image/png"));
      await waitFor(() => expect(puts.length + document.querySelectorAll("[data-status=uploading]").length).toBeGreaterThan(0));
      save();
      expect((await screen.findByTestId("product-form-error")).textContent).toBe(p.editor.uploadingWait);
      expect(writes()).toHaveLength(0);
    } finally {
      FakeXHR.prototype.send = orig;
    }
  });

  it("ADM-03 · the category form uses the uploader: a new image is sent as {key}", async () => {
    mount("/categories");
    fireEvent.click(await screen.findByRole("button", { name: msgs.categories.editNamed.replace("{name}", cats[1].name[L]) }));
    fireEvent.change(screen.getByTestId("category-image-input"), { target: { files: [file("c.png", "image/png")] } });
    await waitFor(() => expect(screen.getByTestId("uploader-item").getAttribute("data-status")).toBe("done"));
    fireEvent.click(screen.getByRole("button", { name: msgs.common.save }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "PATCH", path: "/admin/categories/c3" });
    expect(writes()[0].body.image).toEqual({ key: "furnixa/test/2026/11/new-1.webp" });
  });

  it("ADM-02 · dark mode keeps the editor on token classes (no hard-coded colours)", async () => {
    document.documentElement.classList.add("dark");
    const { container } = mount("/products/new");
    await screen.findByTestId("product-save");
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b|bg-white|text-black/);
    expect(document.documentElement.getAttribute("dir")).toBe(locale === "ar" ? "rtl" : "ltr");
  });
});
