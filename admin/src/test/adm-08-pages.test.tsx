import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { generateHTML, generateJSON } from "@tiptap/core";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { editorExtensions } from "@/components/rich-text-editor";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { isSafePageHref } from "@/lib/pages";
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

const mk = (id: string, slug: string, en_: string, ar_: string, published: boolean) => ({
  id,
  slug,
  title: { en: en_, ar: ar_ },
  content: { en: `<p>${en_} body</p>`, ar: `<p>${ar_} نص</p>` },
  metaTitle: null,
  metaDescription: null,
  isPublished: published,
  updatedAt: "2026-11-20T10:00:00.000Z",
});
const base = () => [mk("p1", "about", "About us", "من نحن", true), mk("p2", "terms", "Terms", "الشروط", false)];

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
      if (path === "/admin/pages" && method === "GET") return json(list);
      if (path === "/admin/pages" && method === "POST") {
        const row = { ...body, id: "p9", updatedAt: "2026-11-21T00:00:00.000Z" };
        list = [...list, row as (typeof list)[number]];
        return json(row, 201);
      }
      const m = /^\/admin\/pages\/([^/?]+)$/.exec(path);
      if (m && method === "PATCH") {
        const cur = list.find((p) => p.id === m[1])!;
        const next = { ...cur, ...body, updatedAt: "2026-11-21T00:00:00.000Z" } as (typeof list)[number];
        list = list.map((p) => (p.id === cur.id ? next : p));
        return json(next);
      }
      if (m && method === "DELETE") {
        list = list.filter((p) => p.id !== m[1]);
        return new Response(null, { status: 204 });
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
        <MemoryRouter initialEntries={["/pages"]}>
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

describe("ADM-08 · editor schema (ADR-013 allowlist)", () => {
  const roundTrip = (html: string) => generateHTML(generateJSON(html, editorExtensions), editorExtensions);

  it("ADM-08 · keeps the allowlisted tags", () => {
    const html =
      "<h2>A</h2><h3>B</h3><h4>C</h4><p><strong>b</strong><em>i</em><u>u</u><s>s</s><br></p><ul><li><p>x</p></li></ul><ol><li><p>y</p></li></ol><blockquote><p>q</p></blockquote><hr>";
    const out = roundTrip(html);
    for (const tag of ["h2", "h3", "h4", "strong", "em", "u", "s", "ul", "ol", "li", "blockquote", "br", "hr"])
      expect(out).toContain(`<${tag}`);
  });

  it("ADM-08 · drops everything outside the allowlist (h1, code, scripts, styles, handlers)", () => {
    const out = roundTrip(
      '<h1>t</h1><pre><code>c</code></pre><p style="color:red" onclick="x()">p<code>k</code></p><script>alert(1)</script><iframe src="https://x"></iframe><table><tr><td>cell</td></tr></table>',
    );
    for (const bad of ["<h1", "<code", "<pre", "<script", "<iframe", "style=", "onclick", "<table"]) expect(out).not.toContain(bad);
  });

  it("ADM-08 · links: https and same-site paths survive with rel; javascript:, data:, http: and // do not", () => {
    for (const ok of ["https://example.com/a", "/about", "/"]) {
      expect(isSafePageHref(ok)).toBe(true);
      expect(roundTrip(`<p><a href="${ok}">x</a></p>`)).toContain(`href="${ok}"`);
    }
    expect(roundTrip('<p><a href="https://example.com">x</a></p>')).toContain('rel="noopener noreferrer"');
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://example.com", "//evil.com", "/\\evil.com", ""]) {
      expect(isSafePageHref(bad)).toBe(false);
      expect(roundTrip(`<p><a href="${bad}">x</a></p>`)).not.toMatch(/href="[^"]/);
    }
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-08 · static pages (%s)", (locale, msgs) => {
  const s = msgs.pages;
  const L = locale as Locale;
  beforeEach(async () => {
    initI18n(L);
    await setLocale(L);
    localStorage.removeItem(THEME_KEY);
    stubApi();
  });

  it("ADM-08 · lists pages with slug and published/draft state", async () => {
    mount();
    const rows = await screen.findAllByTestId("page-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(base()[0].title[L])).toBeTruthy();
    expect(rows[0].textContent).toContain("/about");
    expect(within(rows[0]).getByTestId("page-state").textContent).toBe(s.published);
    expect(within(rows[1]).getByTestId("page-state").textContent).toBe(s.draft);
  });

  it("ADM-08 · the editor shows both locale tabs; the ar editor is RTL and the en editor LTR; works in dark mode", async () => {
    localStorage.setItem(THEME_KEY, "dark");
    mount();
    fireEvent.click(await screen.findByLabelText(s.editNamed.replace("{name}", base()[0].title[L])));
    const dlg = await screen.findByTestId("page-dialog");
    expect(within(dlg).getAllByRole("tab").map((x) => x.textContent)).toEqual([msgs.common.arabic, msgs.common.english]);
    const arEd = await screen.findByLabelText(s.form.contentAr, { selector: "[role=textbox]" });
    expect(arEd.getAttribute("dir")).toBe("rtl");
    expect(arEd.textContent).toContain("نص");
    fireEvent.click(within(dlg).getByRole("tab", { name: msgs.common.english }));
    const enEd = document.getElementById("page-content-en")!;
    expect(enEd.getAttribute("dir")).toBe("ltr");
    expect(enEd.textContent).toContain("About us body");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(within(dlg).getByRole("toolbar", { name: s.editor.toolbar })).toBeTruthy();
  });

  it("ADM-08 · saving an edit sends expectedUpdatedAt and the slug/title/content/isPublished fields", async () => {
    mount();
    fireEvent.click(await screen.findByLabelText(s.editNamed.replace("{name}", base()[0].title[L])));
    await screen.findByTestId("page-dialog");
    fill(s.form.titleEn, "About Furnixa");
    fireEvent.click(screen.getByTestId("page-save"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const w = writes()[0];
    expect(w.method).toBe("PATCH");
    expect(w.path).toBe("/admin/pages/p1");
    expect(w.body.expectedUpdatedAt).toBe("2026-11-20T10:00:00.000Z");
    expect(w.body.title).toEqual({ en: "About Furnixa", ar: "من نحن" });
    expect(w.body.slug).toBe("about");
    expect(w.body.isPublished).toBe(true);
    expect(w.body.content.en).toContain("About us body");
    await waitFor(() => expect(screen.queryByTestId("page-dialog")).toBeNull());
  });

  it("ADM-08 · creating: slug pattern is validated, a draft needs one locale, and POST is sent", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("page-new"));
    await screen.findByTestId("page-dialog");
    fill(s.form.slug, "Bad Slug");
    fireEvent.click(screen.getByTestId("page-save"));
    expect(await screen.findByText(s.form.slugInvalid)).toBeTruthy();
    expect(writes()).toHaveLength(0);
    fill(s.form.slug, "faq");
    fireEvent.click(screen.getByTestId("page-save"));
    expect((await screen.findAllByText(s.form.atLeastOne)).length).toBeGreaterThan(0);
    expect(writes()).toHaveLength(0);
    fill(s.form.titleEn, "FAQ");
    fireEvent.click(screen.getByTestId("page-save"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].method).toBe("POST");
    expect(writes()[0].body).toMatchObject({ slug: "faq", title: { en: "FAQ", ar: "" }, isPublished: false });
    expect(writes()[0].body.expectedUpdatedAt).toBeUndefined();
  });

  it("ADM-08 · publishing requires title and content in both languages (nothing sent)", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("page-new"));
    await screen.findByTestId("page-dialog");
    fill(s.form.slug, "faq");
    fill(s.form.titleEn, "FAQ");
    fireEvent.click(screen.getByLabelText(s.form.published));
    fireEvent.click(screen.getByTestId("page-save"));
    expect((await screen.findAllByText(s.form.publishNeedsBoth)).length).toBeGreaterThan(0);
    expect(writes()).toHaveLength(0);
  });

  it("ADM-08 · a link with a disallowed address is refused in the toolbar; an https one is accepted", async () => {
    mount();
    fireEvent.click(await screen.findByLabelText(s.editNamed.replace("{name}", base()[0].title[L])));
    await screen.findByTestId("page-dialog");
    const ed = document.getElementById("page-content-ar")!;
    await waitFor(() => expect(ed.textContent).toContain("نص"));
    fireEvent.click(screen.getByTestId("page-content-ar-link"));
    const input = screen.getByTestId("page-content-ar-link-input");
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByTestId("page-content-ar-link-apply"));
    expect(screen.getByTestId("page-content-ar-link-error").textContent).toBe(s.editor.linkInvalid);
    fireEvent.change(input, { target: { value: "https://example.com" } });
    expect(screen.queryByTestId("page-content-ar-link-error")).toBeNull();
    fireEvent.click(screen.getByTestId("page-content-ar-link-apply"));
    expect(screen.queryByTestId("page-content-ar-link-input")).toBeNull();
  });

  it("ADM-08 · 409 STALE_UPDATE shows the reload notice, keeps the edit and reloads on request", async () => {
    mount();
    fireEvent.click(await screen.findByLabelText(s.editNamed.replace("{name}", base()[0].title[L])));
    await screen.findByTestId("page-dialog");
    fill(s.form.titleEn, "Changed title");
    failNext = { status: 409, code: "STALE_UPDATE", method: "PATCH" };
    fireEvent.click(screen.getByTestId("page-save"));
    const stale = await screen.findByTestId("page-stale");
    expect(stale.textContent).toContain(s.form.stale);
    expect(stale.textContent).not.toContain("Raw English API text");
    expect((screen.getByLabelText(s.form.titleEn) as HTMLInputElement).value).toBe("Changed title");
    list = list.map((p) => (p.id === "p1" ? { ...p, title: { ...p.title, en: "Server title" }, updatedAt: "2026-11-22T00:00:00.000Z" } : p));
    fireEvent.click(within(stale).getByRole("button", { name: s.form.reload }));
    await waitFor(() => expect((screen.getByLabelText(s.form.titleEn) as HTMLInputElement).value).toBe("Server title"));
    fireEvent.click(screen.getByTestId("page-save"));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body.expectedUpdatedAt).toBe("2026-11-22T00:00:00.000Z");
  });

  it("ADM-08 · a duplicate slug shows the localised SLUG_TAKEN message, never the API text", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("page-new"));
    await screen.findByTestId("page-dialog");
    fill(s.form.slug, "about");
    fill(s.form.titleEn, "Dup");
    failNext = { status: 409, code: "SLUG_TAKEN", method: "POST" };
    fireEvent.click(screen.getByTestId("page-save"));
    const err = await screen.findByTestId("page-form-error");
    expect(err.textContent).toBe(msgs.errors.SLUG_TAKEN);
    expect(err.textContent).not.toContain("Raw English API text");
  });

  it("ADM-08 · deleting asks for confirmation, then sends DELETE", async () => {
    mount();
    fireEvent.click(await screen.findByLabelText(s.deleteNamed.replace("{name}", base()[1].title[L])));
    const dlg = await screen.findByTestId("page-delete-dialog");
    expect(writes()).toHaveLength(0);
    fireEvent.click(within(dlg).getByTestId("page-delete-confirm"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "DELETE", path: "/admin/pages/p2" });
    await waitFor(() => expect(screen.getAllByTestId("page-row")).toHaveLength(1));
  });
});
