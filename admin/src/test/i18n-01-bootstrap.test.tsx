import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient, logout, refreshSession } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { errorKey } from "@/lib/api/errors";
import { LOCALE_KEY, initI18n, setLocale } from "@/lib/i18n";
import { THEME_KEY, ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

function mount() {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  // The app restores its session from the refresh cookie on mount (T-061): never hit a real API in tests.
  configureApiClient({
    fetch: (async () =>
      new Response(JSON.stringify({ code: "UNAUTHORIZED" }), { status: 401 })) as unknown as typeof fetch,
  });
  authStore.clear();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  initI18n("ar");
  await setLocale("ar");
  localStorage.clear();
});

describe("I18N-01 · language and direction (en + ar)", () => {
  it("I18N-01 · defaults to Arabic with dir=rtl and lang=ar", () => {
    mount();
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ar.app.title);
  });

  it("I18N-01 · switching to English sets dir=ltr, translates and remembers the choice", async () => {
    mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId("locale-toggle"));
    });
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(en.app.title);
    expect(localStorage.getItem(LOCALE_KEY)).toBe("en");
  });

  it("I18N-01 · a remembered English choice is applied at start-up (ltr)", () => {
    localStorage.setItem(LOCALE_KEY, "en");
    initI18n();
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.documentElement.lang).toBe("en");
  });
});

describe("I18N-01 · dark mode (en + ar)", () => {
  for (const loc of ["en", "ar"] as const) {
    it(`I18N-01 · toggle adds the dark class and persists it (${loc})`, async () => {
      await setLocale(loc);
      const view = mount();
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      fireEvent.click(screen.getByTestId("theme-toggle"));
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(localStorage.getItem(THEME_KEY)).toBe("dark");
      view.unmount();
      document.documentElement.classList.remove("dark");
      mount(); // a fresh start restores the stored theme
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(screen.getByTestId("theme-toggle").getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(screen.getByTestId("theme-toggle"));
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(localStorage.getItem(THEME_KEY)).toBe("light");
    });
  }
});

describe("I18N-01 · key parity script", () => {
  const script = path.resolve(import.meta.dirname, "../../../scripts/i18n-check.mjs");
  const run = (a: string, b: string) => execFileSync("node", [script, a, b], { encoding: "utf8", stdio: "pipe" });

  it("I18N-01 · passes for the real en/ar files", () => {
    const root = path.resolve(import.meta.dirname, "../locales");
    expect(run(path.join(root, "en.json"), path.join(root, "ar.json"))).toContain("i18n OK");
  });

  it("I18N-01 · fails when a key is missing in one locale", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "i18n-"));
    writeFileSync(path.join(dir, "a.json"), JSON.stringify({ a: "1", b: "2" }));
    writeFileSync(path.join(dir, "b.json"), JSON.stringify({ a: "1" }));
    expect(() => run(path.join(dir, "a.json"), path.join(dir, "b.json"))).toThrow();
  });
});

describe("I18N-01 · API errors map to localized messages", () => {
  it("I18N-01 · every known code and the fallback exist in both locales", () => {
    for (const code of ["CSRF_INVALID", "UNAUTHORIZED", "NETWORK_ERROR"]) {
      const key = errorKey(code).split(".")[1] as keyof typeof en.errors;
      expect(en.errors[key]).toBeTruthy();
      expect(ar.errors[key]).toBeTruthy();
    }
    expect(errorKey("SOMETHING_NEW")).toBe("errors.generic");
  });
});

describe("I18N-01 · API client CSRF (ADR-011)", () => {
  const user = {
    id: "1", firstName: "A", lastName: "B", email: "a@b.c", role: "ADMIN",
    isVerified: true, isBlocked: false, preferredLocale: "ar" as const,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("I18N-01 · fetches the CSRF token before refresh and logout, in memory only", async () => {
    authStore.clear();
    const calls: { url: string; method: string; csrf?: string; credentials?: string }[] = [];
    configureApiClient({
      getLocale: () => "en",
      fetch: (async (url: string, init: RequestInit) => {
        const h = init.headers as Record<string, string>;
        calls.push({ url, method: init.method ?? "GET", csrf: h["X-CSRF-Token"], credentials: init.credentials });
        if (url.endsWith("/auth/csrf")) return json({ csrfToken: "tok-1" });
        if (url.endsWith("/auth/refresh")) return json({ accessToken: "at-1", user });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    await refreshSession();
    await logout();
    configureApiClient(null);

    expect(calls.map((c) => `${c.method} ${c.url.replace(/^.*\/api\/v1/, "")}`)).toEqual([
      "GET /auth/csrf",
      "POST /auth/refresh",
      "POST /auth/logout",
    ]);
    expect(calls[1].csrf).toBe("tok-1");
    expect(calls[2].csrf).toBe("tok-1"); // cached, survives the rotation
    expect(calls.every((c) => c.credentials === "include")).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(authStore.get().accessToken).toBeNull();
  });
});
