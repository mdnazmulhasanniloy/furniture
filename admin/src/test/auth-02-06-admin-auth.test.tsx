import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { api, configureApiClient, refreshSession } from "@/lib/api/client";
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
const customerUser = { ...adminUser, id: "u2", role: "CUSTOMER", email: "c@furnixa.test" };

type Call = { method: string; path: string; headers: Record<string, string>; body?: unknown; credentials?: string };
type Handler = (c: Call) => Response | undefined;

const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...headers } });

let calls: Call[] = [];
function stubApi(handler: Handler) {
  calls = [];
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init: RequestInit) => {
      const c: Call = {
        method: init.method ?? "GET",
        path: url.replace(/^.*\/api\/v1/, ""),
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        credentials: init.credentials,
      };
      calls.push(c);
      const r = handler(c);
      if (r) return r;
      if (c.path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (c.path === "/auth/refresh") return json({ code: "UNAUTHORIZED" }, 401);
      if (c.path === "/auth/logout") return new Response(null, { status: 204 });
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount(path = "/") {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

async function useLocale(l: Locale) {
  initI18n(l);
  await setLocale(l);
  localStorage.removeItem(THEME_KEY);
}

async function signIn(email = "sara@furnixa.test", password = "Secret123") {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/^(Email|البريد الإلكتروني)/), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(/^(Password|كلمة المرور)/), { target: { value: password } });
  });
  await act(async () => {
    fireEvent.submit(document.querySelector("form")!);
  });
}

beforeEach(() => {
  authStore.clear();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(() => configureApiClient(null));

const loginOk = (user = adminUser) => (c: Call) =>
  c.path === "/auth/login" ? json({ accessToken: "at-1", user }) : undefined;

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("AUTH-06 · protected routes and shell (%s)", (locale, msgs) => {
  beforeEach(async () => {
    await useLocale(locale);
  });

  it("AUTH-06 · no session: opening the dashboard redirects to the login screen", async () => {
    stubApi(() => undefined);
    mount("/orders");
    expect(await screen.findByRole("heading", { level: 2, name: msgs.auth.loginTitle })).toBeTruthy();
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
  });

  it("AUTH-06 · a customer refresh cookie does not open the dashboard", async () => {
    stubApi((c) => {
      if (c.path === "/auth/refresh") return json({ accessToken: "at-c", user: customerUser });
      return undefined;
    });
    mount("/");
    expect(await screen.findByRole("heading", { level: 2, name: msgs.auth.loginTitle })).toBeTruthy();
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(authStore.get().accessToken).toBeNull();
    // The storefront session is not revoked from here.
    expect(calls.some((c) => c.path === "/auth/logout")).toBe(false);
  });

  it("AUTH-06 · an admin session shows the shell with a collapsible sidebar that mirrors in RTL", async () => {
    stubApi((c) => (c.path === "/auth/refresh" ? json({ accessToken: "at-1", user: adminUser }) : undefined));
    mount("/");
    const sidebar = await screen.findByTestId("sidebar");
    // Logical properties only: the sidebar border is on the inline-end edge, so dir flips it.
    expect(sidebar.className).toContain("border-e");
    expect(sidebar.className).not.toMatch(/border-r\b|border-l\b/);
    expect(sidebar.getAttribute("data-collapsed")).toBe("false");
    expect(screen.getByRole("navigation", { name: msgs.shell.mainNav })).toBeTruthy();
    expect(screen.getByTestId("topbar-search")).toBeTruthy();
    expect(screen.getByTestId("bell")).toBeTruthy();
    expect(screen.getByTestId("locale-toggle")).toBeTruthy();
    expect(screen.getByTestId("theme-toggle")).toBeTruthy();

    fireEvent.click(screen.getByTestId("sidebar-toggle"));
    expect(sidebar.getAttribute("data-collapsed")).toBe("true");
    expect(screen.getByTestId("sidebar-toggle").getAttribute("aria-label")).toBe(msgs.shell.expandSidebar);
    // Link names stay available to screen readers while collapsed.
    expect(screen.getByRole("link", { name: msgs.nav.orders })).toBeTruthy();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
  });

  it("AUTH-06 · avatar menu signs out: session cleared, back on the login screen", async () => {
    stubApi((c) => (c.path === "/auth/refresh" ? json({ accessToken: "at-1", user: adminUser }) : undefined));
    mount("/");
    await screen.findByTestId("sidebar");
    fireEvent.click(screen.getByTestId("avatar-button"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("logout"));
    });
    expect(await screen.findByRole("heading", { level: 2, name: msgs.auth.loginTitle })).toBeTruthy();
    const out = calls.find((c) => c.path === "/auth/logout")!;
    expect(out.headers["X-CSRF-Token"]).toBe("csrf-1");
    expect(authStore.get().accessToken).toBeNull();
  });
});

describe("AUTH-06 · dark mode", () => {
  it("AUTH-06 · login and shell render in dark mode (ar, RTL)", async () => {
    await useLocale("ar");
    localStorage.setItem(THEME_KEY, "dark");
    stubApi((c) => (c.path === "/auth/refresh" ? json({ accessToken: "at-1", user: adminUser }) : undefined));
    mount("/");
    await screen.findByTestId("sidebar");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dir).toBe("rtl");
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("AUTH-02 · admin login (%s)", (locale, msgs) => {
  beforeEach(async () => {
    await useLocale(locale);
  });

  it("AUTH-02 · valid admin credentials open the dashboard; token in memory only, CSRF primed", async () => {
    stubApi(loginOk());
    mount("/login");
    await signIn();
    expect(await screen.findByTestId("sidebar")).toBeTruthy();
    expect(authStore.get().accessToken).toBe("at-1");
    expect(authStore.get().csrfToken).toBe("csrf-1");
    const login = calls.find((c) => c.path === "/auth/login")!;
    expect(login.credentials).toBe("include");
    expect(login.body).toEqual({ email: "sara@furnixa.test", password: "Secret123" });
    expect(localStorage.length).toBeLessThanOrEqual(2); // only language and theme preferences
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.getItem(localStorage.key(i)!)).not.toContain("at-1");
    }
  });

  it("AUTH-02 · a CUSTOMER login is rejected with a message, the session is revoked and not kept", async () => {
    stubApi(loginOk(customerUser));
    mount("/login");
    await signIn("c@furnixa.test");
    expect((await screen.findByTestId("login-error")).textContent).toBe(msgs.errors.NOT_ADMIN);
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(authStore.get().accessToken).toBeNull();
    expect(calls.some((c) => c.path === "/auth/logout" && c.headers["X-CSRF-Token"] === "csrf-1")).toBe(true);
  });

  it("AUTH-02 · INVALID_CREDENTIALS shows the localized message, never the API text", async () => {
    stubApi((c) =>
      c.path === "/auth/login" ? json({ code: "INVALID_CREDENTIALS", message: "English API text" }, 401) : undefined,
    );
    mount("/login");
    await signIn();
    const el = await screen.findByTestId("login-error");
    expect(el.textContent).toBe(msgs.errors.INVALID_CREDENTIALS);
    expect(el.textContent).not.toContain("English API text");
  });

  it("AUTH-02 · RATE_LIMITED uses Retry-After ('Try again in 12 minutes')", async () => {
    stubApi((c) =>
      c.path === "/auth/login" ? json({ code: "RATE_LIMITED" }, 429, { "Retry-After": "720" }) : undefined,
    );
    mount("/login");
    await signIn();
    const el = await screen.findByTestId("login-error");
    const expected = `${msgs.errors.RATE_LIMITED} ${msgs.errors.retryMinutes.other.replace("{n}", new Intl.NumberFormat(locale).format(12))}`;
    expect(el.textContent).toBe(expected);
    if (locale === "en") expect(el.textContent).toContain("Try again in 12 minutes");
  });

  it("AUTH-02 · ACCOUNT_LOCKED uses Retry-After (seconds and singular forms)", async () => {
    stubApi((c) =>
      c.path === "/auth/login" ? json({ code: "ACCOUNT_LOCKED" }, 429, { "Retry-After": "60" }) : undefined,
    );
    mount("/login");
    await signIn();
    expect((await screen.findByTestId("login-error")).textContent).toBe(
      `${msgs.errors.ACCOUNT_LOCKED} ${msgs.errors.retryMinutes.one}`,
    );
  });

  it("AUTH-02 · restore on load: refresh cookie + CSRF token give a session without a login", async () => {
    stubApi((c) => (c.path === "/auth/refresh" ? json({ accessToken: "at-2", user: adminUser }) : undefined));
    mount("/orders");
    expect(await screen.findByTestId("sidebar")).toBeTruthy();
    expect(calls.map((c) => `${c.method} ${c.path}`).slice(0, 2)).toEqual(["GET /auth/csrf", "POST /auth/refresh"]);
    expect(calls[1].headers["X-CSRF-Token"]).toBe("csrf-1");
    expect(authStore.get().accessToken).toBe("at-2");
  });

  it("AUTH-02 · REFRESH_RACE is retried once and does not log the admin out", async () => {
    let n = 0;
    stubApi((c) => {
      if (c.path !== "/auth/refresh") return undefined;
      return ++n === 1 ? json({ code: "REFRESH_RACE" }, 401) : json({ accessToken: "at-3", user: adminUser });
    });
    mount("/");
    expect(await screen.findByTestId("sidebar")).toBeTruthy();
    expect(n).toBe(2);
    expect(authStore.get().accessToken).toBe("at-3");
  });

  it("AUTH-02 · refresh is single-flight and an expired access token is refreshed once, then retried", async () => {
    let refreshes = 0;
    stubApi((c) => {
      if (c.path === "/auth/refresh") {
        refreshes++;
        return json({ accessToken: "at-new", user: adminUser });
      }
      if (c.path === "/admin/ping") {
        return c.headers.Authorization === "Bearer at-new" ? json({ ok: true }) : json({ code: "UNAUTHORIZED" }, 401);
      }
      return undefined;
    });
    authStore.setSession({ accessToken: "at-old", user: adminUser as never });
    const results = await Promise.all([api.get("/admin/ping"), api.get("/admin/ping"), api.get("/admin/ping")]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
    await refreshSession();
    expect(refreshes).toBe(2);
  });

  it("AUTH-02 · a failed refresh ends the session and returns the admin to the login screen", async () => {
    stubApi((c) => (c.path === "/admin/ping" ? json({ code: "UNAUTHORIZED" }, 401) : undefined));
    authStore.setSession({ accessToken: "at-old", user: adminUser as never });
    mount("/");
    await screen.findByTestId("sidebar");
    await act(async () => {
      await api.get("/admin/ping").catch(() => undefined);
    });
    expect(await screen.findByRole("heading", { level: 2, name: msgs.auth.loginTitle })).toBeTruthy();
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("AUTH-02 · accept-invite screen (%s)", (locale, msgs) => {
  beforeEach(async () => {
    await useLocale(locale);
  });

  const fill = async (code: string, password: string) => {
    await act(async () => {
      fireEvent.change(screen.getByLabelText(msgs.auth.code), { target: { value: code } });
      fireEvent.change(screen.getByLabelText(msgs.auth.newPassword), { target: { value: password } });
    });
    await act(async () => {
      fireEvent.submit(document.querySelector("form")!);
    });
  };

  it("AUTH-02 · email is prefilled from ?email=, the code is never in the URL, 200 stores the session", async () => {
    stubApi((c) => (c.path === "/auth/accept-invite" ? json({ accessToken: "at-i", user: adminUser }) : undefined));
    mount("/accept-invite?email=new%40furnixa.test");
    expect((screen.getByLabelText(msgs.auth.email) as HTMLInputElement).value).toBe("new@furnixa.test");
    await fill("123456", "Passw0rdOK");
    expect(await screen.findByTestId("sidebar")).toBeTruthy();
    const call = calls.find((c) => c.path === "/auth/accept-invite")!;
    expect(call.body).toEqual({ email: "new@furnixa.test", code: "123456", password: "Passw0rdOK" });
    expect(call.path).not.toContain("123456");
    expect(authStore.get().accessToken).toBe("at-i");
  });

  it("AUTH-02 · Arabic-Indic digits typed on an Arabic keyboard are accepted and sent as ASCII", async () => {
    stubApi((c) => (c.path === "/auth/accept-invite" ? json({ accessToken: "at-i", user: adminUser }) : undefined));
    mount("/accept-invite?email=new%40furnixa.test");
    await fill("١٢٣٤٥٦", "Passw0rdOK");
    expect(await screen.findByTestId("sidebar")).toBeTruthy();
    expect((calls.find((c) => c.path === "/auth/accept-invite")!.body as { code: string }).code).toBe("123456");
  });

  it("AUTH-02 · weak password and malformed code are rejected locally with the localized rule", async () => {
    stubApi(() => undefined);
    mount("/accept-invite?email=new%40furnixa.test");
    await fill("12", "short");
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(msgs.auth.invalidCode);
    expect(calls.some((c) => c.path === "/auth/accept-invite")).toBe(false);
  });

  it("AUTH-02 · 400 OTP_INVALID shows a generic message plus a hint to ask for a new invite", async () => {
    stubApi((c) => (c.path === "/auth/accept-invite" ? json({ code: "OTP_INVALID" }, 400) : undefined));
    mount("/accept-invite?email=new%40furnixa.test");
    await fill("123456", "Passw0rdOK");
    expect((await screen.findByTestId("invite-error")).textContent).toContain(msgs.errors.OTP_INVALID);
    expect(screen.getByTestId("invite-hint").textContent).toBe(msgs.auth.inviteHint);
  });

  it("AUTH-02 · 422 keeps the typed code usable (form not reset, no new-invite hint)", async () => {
    stubApi((c) => (c.path === "/auth/accept-invite" ? json({ code: "VALIDATION_ERROR" }, 422) : undefined));
    mount("/accept-invite?email=new%40furnixa.test");
    await fill("123456", "Passw0rdOK");
    expect((await screen.findByTestId("invite-error")).textContent).toContain(msgs.errors.VALIDATION_ERROR);
    expect((screen.getByLabelText(msgs.auth.code) as HTMLInputElement).value).toBe("123456");
    expect(screen.queryByTestId("invite-hint")).toBeNull();
  });
});

describe("AUTH-02 · locale catalogue", () => {
  it("AUTH-02 · every auth error code has an en and ar message", () => {
    for (const code of ["INVALID_CREDENTIALS", "RATE_LIMITED", "ACCOUNT_LOCKED", "ACCOUNT_BLOCKED", "EMAIL_NOT_VERIFIED", "OTP_INVALID", "NOT_ADMIN"]) {
      expect((en.errors as Record<string, unknown>)[code]).toBeTruthy();
      expect((ar.errors as Record<string, unknown>)[code]).toBeTruthy();
    }
  });
});

