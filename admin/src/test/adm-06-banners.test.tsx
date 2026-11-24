import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { isoToRiyadh, isSafeHref, riyadhToIso } from "@/lib/banners";
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

const asset = (n: string) => ({
  key: `furnixa/test/2026/11/${n}.webp`,
  url: `https://cdn.test/${n}.webp`,
  alt: { en: `Alt ${n}`, ar: `بديل ${n}` },
  width: null,
  height: null,
});
const base = () => [
  {
    id: "b1",
    title: { en: "Winter sale", ar: "تخفيضات الشتاء" },
    subtitle: { en: "Up to 30%", ar: "حتى ٣٠٪" },
    ctaLabel: { en: "Shop now", ar: "تسوق الآن" },
    ctaHref: "/shop",
    imageDesktop: asset("d1"),
    imageMobile: asset("m1"),
    startsAt: null,
    endsAt: null,
    sortOrder: 1,
    isActive: true,
    updatedAt: "2026-11-20T10:00:00.000Z",
  },
  {
    id: "b2",
    title: { en: "Spring", ar: "الربيع" },
    subtitle: null,
    ctaLabel: null,
    ctaHref: null,
    imageDesktop: asset("d2"),
    imageMobile: null,
    startsAt: "2099-01-01T00:00:00.000Z",
    endsAt: null,
    sortOrder: 2,
    isActive: true,
    updatedAt: "2026-11-20T10:00:00.000Z",
  },
];

type Call = { method: string; path: string; body: Record<string, unknown> };
let calls: Call[] = [];
let list: ReturnType<typeof base> = base();
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
      if (path === "/admin/uploads/presign") {
        const n = calls.filter((c) => c.path.includes("presign")).length;
        return json({
          uploadUrl: "https://r2.test/secret-presigned-put?sig=SECRET",
          key: `furnixa/test/2026/11/new-${n}.webp`,
          publicUrl: `https://cdn.test/new-${n}.webp`,
          expiresIn: 300,
        });
      }
      if (path === "/admin/banners" && method === "GET") return json(list);
      if (path === "/admin/banners" && method === "POST") {
        const b = body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const row = {
          ...(b as object),
          id: "b9",
          imageDesktop: { ...b.imageDesktop, url: "https://cdn.test/x.webp" },
          imageMobile: b.imageMobile ? { ...b.imageMobile, url: "https://cdn.test/y.webp" } : null,
          updatedAt: "2026-11-21T00:00:00.000Z",
        };
        list = [...list, row as unknown as (typeof list)[number]];
        return json(row, 201);
      }
      const m = /^\/admin\/banners\/([^/?]+)$/.exec(path);
      if (m && method === "PATCH") {
        const cur = list.find((b) => b.id === m[1])!;
        const next = { ...cur, ...body, updatedAt: "2026-11-21T00:00:00.000Z" } as unknown as (typeof list)[number];
        list = list.map((b) => (b.id === cur.id ? next : b));
        return json(next);
      }
      if (m && method === "DELETE") {
        list = list.filter((b) => b.id !== m[1]);
        return new Response(null, { status: 204 });
      }
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

// Fake XMLHttpRequest: no network, records the PUT to the presigned URL (uploads are mocked).
type Put = { method: string; url: string; headers: Record<string, string> };
let puts: Put[] = [];
class FakeXHR {
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  private rec: Put = { method: "", url: "", headers: {} };
  open(method: string, url: string) {
    this.rec.method = method;
    this.rec.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.rec.headers[k] = v;
  }
  send() {
    puts.push(this.rec);
    setTimeout(() => {
      this.status = 200;
      this.onload?.();
    }, 0);
  }
}

function mount() {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/banners"]}>
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
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});
afterEach(() => {
  configureApiClient(null);
  vi.unstubAllGlobals();
});

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const writes = () => calls.filter((c) => c.method !== "GET" && !c.path.includes("presign"));
const file = (name: string, type = "image/webp") => new File(["x"], name, { type });

describe("ADM-06 · CTA link rule (api-spec SafeHref)", () => {
  it("ADM-06 · accepts a same-site path or an https URL; refuses //host, /\\host, javascript:, data:, http:", () => {
    for (const ok of ["/", "/shop", "/products/sofa?x=1", "https://example.com", "https://example.com/a?b=c"])
      expect(isSafeHref(ok), ok).toBe(true);
    for (const bad of [
      "",
      "//evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "data:text/html,x",
      "http://example.com",
      "shop",
      "ftp://x.com",
      "https://",
      " /shop",
      "/" + "a".repeat(500),
    ])
      expect(isSafeHref(bad), bad).toBe(false);
  });

  it("ADM-06 · schedule inputs are Riyadh wall-clock times (UTC+3)", () => {
    expect(riyadhToIso("2026-12-01T09:30")).toBe("2026-12-01T06:30:00.000Z");
    expect(isoToRiyadh("2026-12-01T06:30:00.000Z")).toBe("2026-12-01T09:30");
    expect(isoToRiyadh(null)).toBe("");
    expect(riyadhToIso("")).toBeNull();
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-06 · banners (%s)", (locale, msgs) => {
  const b = msgs.banners;
  const L = locale as Locale;
  beforeEach(async () => {
    initI18n(L);
    await setLocale(L);
    localStorage.removeItem(THEME_KEY);
    stubApi();
  });
  const openNew = async () => {
    mount();
    await screen.findByTestId("banners-table");
    fireEvent.click(screen.getByTestId("banner-new"));
  };
  const fillBasics = () => {
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${msgs.common.english}`) }));
    fill(b.form.titleEn, "Sale");
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${msgs.common.arabic}`) }));
    fill(b.form.titleAr, "تخفيض");
  };
  const uploadDesktop = async () => {
    fireEvent.change(screen.getByTestId("banner-image-desktop-input"), { target: { files: [file("hero.webp")] } });
    await waitFor(() =>
      expect(within(screen.getByTestId("banner-image-desktop")).getByTestId("uploader-item").getAttribute("data-status")).toBe("done"),
    );
  };
  const altDesktop = (en_: string, ar_: string) => {
    const box = within(screen.getByTestId("banner-image-desktop"));
    fireEvent.change(box.getByLabelText(msgs.uploader.altEnN.replace("{n}", "1")), { target: { value: en_ } });
    fireEvent.change(box.getByLabelText(msgs.uploader.altArN.replace("{n}", "1")), { target: { value: ar_ } });
  };

  it("ADM-06 · lists banners by sort order with both titles, schedule state and the mobile-image flag", async () => {
    mount();
    const rows = await screen.findAllByTestId("banner-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain(base()[0].title[L]);
    expect(rows[0].textContent).toContain(base()[0].title[L === "en" ? "ar" : "en"]);
    expect(within(rows[0]).getByTestId("banner-state").textContent).toBe(b.state.active);
    expect(within(rows[0]).getByTestId("banner-has-mobile")).toBeTruthy();
    expect(within(rows[1]).getByTestId("banner-state").textContent).toBe(b.state.scheduled);
    expect(screen.getByRole("heading", { level: 1, name: b.title })).toBeTruthy();
  });

  it("ADM-06 · create needs both titles, a desktop image and alt text in both languages", async () => {
    await openNew();
    fireEvent.click(screen.getByTestId("banner-save"));
    expect((await screen.findAllByText(b.form.required)).length).toBeGreaterThan(0);
    expect(writes()).toHaveLength(0);
    fillBasics();
    fireEvent.click(screen.getByTestId("banner-save"));
    expect((await screen.findByTestId("banner-form-error")).textContent).toBe(b.form.desktopRequired);
    await uploadDesktop();
    fireEvent.click(screen.getByTestId("banner-save"));
    await waitFor(() => expect(screen.getByTestId("banner-form-error").textContent).toBe(b.form.altRequired));
    altDesktop("Hero", "");
    fireEvent.click(screen.getByTestId("banner-save"));
    await waitFor(() => expect(screen.getByTestId("banner-form-error").textContent).toBe(b.form.altRequired));
    expect(writes()).toHaveLength(0);
  });

  it("ADM-06 · desktop image uses the presign uploader and the saved body carries only {key, alt}", async () => {
    await openNew();
    fillBasics();
    await uploadDesktop();
    const presign = calls.find((c) => c.path === "/admin/uploads/presign")!;
    expect(presign.body).toMatchObject({ fileName: "hero.webp", contentType: "image/webp" });
    expect(puts).toHaveLength(1);
    expect(puts[0].method).toBe("PUT");
    expect(puts[0].headers).toEqual({ "Content-Type": "image/webp" });
    altDesktop("Hero", "بطل");
    fill(b.form.ctaHref, "https://example.com/sale");
    fill(b.form.sortOrder, "3");
    fireEvent.click(screen.getByTestId("banner-save"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const body = writes()[0].body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(writes()[0].method).toBe("POST");
    expect(body.title).toEqual({ en: "Sale", ar: "تخفيض" });
    expect(body.subtitle).toBeNull();
    expect(body.ctaLabel).toBeNull();
    expect(body.ctaHref).toBe("https://example.com/sale");
    expect(body.sortOrder).toBe(3);
    expect(body.imageDesktop).toEqual({ key: "furnixa/test/2026/11/new-1.webp", alt: { en: "Hero", ar: "بطل" } });
    expect(body.imageMobile).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(document.body.textContent).not.toContain("secret-presigned-put");
    await waitFor(() => expect(screen.queryByTestId("banner-dialog")).toBeNull());
  });

  it("ADM-06 · an unsafe CTA link is refused before any request", async () => {
    await openNew();
    fillBasics();
    for (const bad of ["//evil.com", "/\\evil.com", "javascript:alert(1)", "data:text/html,x", "http://example.com"]) {
      fill(b.form.ctaHref, bad);
      fireEvent.click(screen.getByTestId("banner-save"));
      expect(await screen.findByText(b.form.hrefInvalid)).toBeTruthy();
    }
    expect(writes()).toHaveLength(0);
  });

  it("ADM-06 · subtitle and button label are both languages or none; the end must be after the start", async () => {
    await openNew();
    fillBasics();
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${msgs.common.english}`) }));
    fill(b.form.subtitleEn, "Only English");
    fill(b.form.startsAt, "2026-12-02T10:00");
    fill(b.form.endsAt, "2026-12-01T10:00");
    fireEvent.click(screen.getByTestId("banner-save"));
    expect((await screen.findAllByText(b.form.bothLocales)).length).toBeGreaterThan(0);
    expect(screen.getByText(b.form.endBeforeStart)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("ADM-06 · edit PATCHes with expectedUpdatedAt, schedule in UTC from Riyadh time, unchanged images omitted", async () => {
    mount();
    await screen.findByTestId("banners-table");
    fireEvent.click(screen.getByRole("button", { name: b.editNamed.replace("{name}", base()[0].title[L]) }));
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${msgs.common.english}`) }));
    fill(b.form.titleEn, "Winter sale 2");
    fill(b.form.startsAt, "2026-12-01T09:30");
    fireEvent.click(screen.getByTestId("banner-save"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const w = writes()[0];
    expect(w.method).toBe("PATCH");
    expect(w.path).toBe("/admin/banners/b1");
    expect(w.body.expectedUpdatedAt).toBe("2026-11-20T10:00:00.000Z");
    expect(w.body.startsAt).toBe("2026-12-01T06:30:00.000Z");
    expect(w.body.imageDesktop).toBeUndefined();
    expect(w.body.imageMobile).toBeUndefined();
  });

  it("ADM-06 · removing the mobile image sends null and is reflected in the list after save", async () => {
    mount();
    const rows = await screen.findAllByTestId("banner-row");
    expect(within(rows[0]).getByTestId("banner-has-mobile")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: b.editNamed.replace("{name}", base()[0].title[L]) }));
    fireEvent.click(screen.getByRole("button", { name: b.form.removeMobile }));
    fireEvent.click(screen.getByTestId("banner-save"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body.imageMobile).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("banner-dialog")).toBeNull());
    await waitFor(() => expect(within(screen.getAllByTestId("banner-row")[0]).queryByTestId("banner-has-mobile")).toBeNull());
  });

  it("ADM-06 · replacing the desktop image uploads a new key; the desktop image cannot be left empty", async () => {
    mount();
    await screen.findByTestId("banners-table");
    fireEvent.click(screen.getByRole("button", { name: b.editNamed.replace("{name}", base()[0].title[L]) }));
    fireEvent.click(screen.getByRole("button", { name: b.form.removeDesktop }));
    fireEvent.click(screen.getByTestId("banner-save"));
    expect((await screen.findByTestId("banner-form-error")).textContent).toBe(b.form.desktopRequired);
    expect(writes()).toHaveLength(0);
    await uploadDesktop();
    altDesktop("New", "جديد");
    fireEvent.click(screen.getByTestId("banner-save"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body.imageDesktop).toEqual({ key: "furnixa/test/2026/11/new-1.webp", alt: { en: "New", ar: "جديد" } });
  });

  it("ADM-06 · 409 STALE_UPDATE shows the reload message by code, keeps the edits, and reload loads the latest", async () => {
    mount();
    await screen.findByTestId("banners-table");
    fireEvent.click(screen.getByRole("button", { name: b.editNamed.replace("{name}", base()[0].title[L]) }));
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${msgs.common.english}`) }));
    fill(b.form.titleEn, "My edit");
    failNext = { status: 409, code: "STALE_UPDATE" };
    fireEvent.click(screen.getByTestId("banner-save"));
    const box = await screen.findByTestId("banner-stale");
    expect(box.textContent).toContain(b.form.stale);
    expect(document.body.textContent).not.toContain("Raw English API text");
    expect((screen.getByLabelText(b.form.titleEn) as HTMLInputElement).value).toBe("My edit");
    list = list.map((x) => (x.id === "b1" ? { ...x, title: { ...x.title, en: "Server title" }, updatedAt: "2026-11-22T00:00:00.000Z" } : x));
    fireEvent.click(screen.getByRole("button", { name: b.form.reload }));
    await waitFor(() => expect((screen.getByLabelText(b.form.titleEn) as HTMLInputElement).value).toBe("Server title"));
    expect(screen.queryByTestId("banner-stale")).toBeNull();
    fireEvent.click(screen.getByTestId("banner-save"));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body.expectedUpdatedAt).toBe("2026-11-22T00:00:00.000Z");
  });

  it("ADM-06 · other API errors are shown localized by code, never the API text", async () => {
    mount();
    await screen.findByTestId("banners-table");
    fireEvent.click(screen.getByRole("button", { name: b.editNamed.replace("{name}", base()[0].title[L]) }));
    failNext = { status: 422, code: "UPLOAD_NOT_ALLOWED" };
    fireEvent.click(screen.getByTestId("banner-save"));
    const err = await screen.findByTestId("banner-form-error");
    expect(err.textContent).toBe(msgs.errors.UPLOAD_NOT_ALLOWED);
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("ADM-06 · the active switch PATCHes isActive with expectedUpdatedAt", async () => {
    mount();
    await screen.findByTestId("banners-table");
    fireEvent.click(screen.getByRole("switch", { name: b.toggleActive.replace("{name}", base()[0].title[L]) }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ isActive: false, expectedUpdatedAt: "2026-11-20T10:00:00.000Z" });
  });

  it("ADM-06 · delete asks for confirmation, then removes the banner from the list", async () => {
    mount();
    await screen.findByTestId("banners-table");
    fireEvent.click(screen.getByRole("button", { name: b.deleteNamed.replace("{name}", base()[1].title[L]) }));
    expect(screen.getByTestId("banner-delete-dialog").textContent).toContain(base()[1].title[L]);
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("banner-delete-confirm"));
    await waitFor(() => expect(writes()).toEqual([{ method: "DELETE", path: "/admin/banners/b2", body: undefined }]));
    await waitFor(() => expect(screen.getAllByTestId("banner-row")).toHaveLength(1));
  });

  it("ADM-06 · the live preview follows the typed copy and its own en/ar toggle, with the right direction", async () => {
    await openNew();
    fillBasics();
    const preview = screen.getByTestId("banner-preview");
    fireEvent.click(within(preview).getByRole("button", { name: msgs.common.english }));
    expect(within(preview).getByTestId("banner-preview-title").textContent).toBe("Sale");
    expect(within(preview).getByTestId("banner-preview-title").closest("[dir]")?.getAttribute("dir")).toBe("ltr");
    fireEvent.click(within(preview).getByRole("button", { name: msgs.common.arabic }));
    expect(within(preview).getByTestId("banner-preview-title").textContent).toBe("تخفيض");
    expect(within(preview).getByTestId("banner-preview-title").closest("[dir]")?.getAttribute("dir")).toBe("rtl");
  });

  it("UI-01 · the editor hints that the middle of the image shows inside the web hero arch", async () => {
    await openNew();
    expect(screen.getByTestId("banner-image-hint").textContent).toBe(b.form.imageHint);
    expect(screen.getByTestId("banner-crop-hint").textContent).toBe(b.form.cropHint);
    // no image yet: nothing to crop
    expect(screen.queryByTestId("banner-crop-desktop")).toBeNull();
  });

  it("UI-01 · the preview centre-crops each stored image into a 4:5 arch (desktop and mobile)", async () => {
    mount();
    await screen.findByTestId("banners-table");
    fireEvent.click(screen.getByRole("button", { name: b.editNamed.replace("{name}", base()[0].title[L]) }));
    const preview = await screen.findByTestId("banner-preview");
    const desktop = within(preview).getByTestId("banner-crop-desktop");
    const mobile = within(preview).getByTestId("banner-crop-mobile");
    expect(within(desktop).getByTestId("banner-crop-desktop-mask").className).toContain("aspect-[4/5]");
    const img = desktop.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://cdn.test/d1.webp");
    expect(img.className).toContain("object-cover");
    expect(img.className).toContain("object-center"); // same as the web hero: the middle is what shows
    expect(mobile.querySelector("img")!.getAttribute("src")).toBe("https://cdn.test/m1.webp");
    expect(desktop.textContent).toBe(b.form.cropDesktop);
    expect(mobile.textContent).toBe(b.form.cropMobile);
    // the mask is the symmetric arch path in bounding-box units
    const maskId = /url\(#([^)]+)\)/.exec(within(desktop).getByTestId("banner-crop-desktop-mask").getAttribute("style") ?? "")![1];
    const clip = desktop.querySelector(`clipPath[id="${maskId}"]`)!;
    expect(clip.getAttribute("clipPathUnits")).toBe("objectBoundingBox");
    expect(clip.querySelector("path")!.getAttribute("d")).toBe("M0 1 V0.5 C0 0.22 0.3 0.1 0.5 0 C0.7 0.1 1 0.22 1 0.5 V1 Z");
  });

  it("UI-01 · the preview puts the copy on the start side and keeps it flat (no dark overlay, no border)", async () => {
    await openNew();
    fillBasics();
    const frame = screen.getByTestId("banner-preview-frame");
    expect(frame.className).toContain("bg-muted");
    expect(frame.className).not.toMatch(/border|rounded|shadow/);
    expect(frame.innerHTML).not.toContain("bg-foreground/70");
    expect(frame.firstElementChild!.querySelector('[data-testid="banner-preview-title"]')).not.toBeNull();
  });

  it("ADM-06 · the page follows the UI direction and dark mode uses token classes only", async () => {
    document.documentElement.classList.add("dark");
    mount();
    const table = await screen.findByTestId("banners-table");
    expect(table.parentElement?.className).toContain("bg-card");
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
  });
});

describe("ADM-06 · locale files", () => {
  it("ADM-06 · en and ar define the same banners keys", () => {
    const keys = (o: unknown, p = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "object" && v ? keys(v, `${p}${k}.`) : [`${p}${k}`],
      );
    expect(keys(ar.banners).sort()).toEqual(keys(en.banners).sort());
  });
});
