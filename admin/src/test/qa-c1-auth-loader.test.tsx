import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

/**
 * QA 2026-11-25 (C1). Opening an unknown admin URL flashed the sign-in form before "Page not found":
 * the route guard decided on a status that was already "anonymous" from an earlier attempt while the
 * current session restore was still in flight. The guard now waits for it.
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

/** The session restore takes a moment, as it does in a browser. */
let refreshDelayMs = 30;
let refreshOk = true;
function stubApi() {
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string) => {
      const p = url.replace(/^.*\/api\/v1/, "");
      if (p === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (p === "/auth/refresh") {
        await new Promise((r) => setTimeout(r, refreshDelayMs));
        return refreshOk ? json({ accessToken: "at-1", user: adminUser }) : json({ code: "UNAUTHORIZED" }, 401);
      }
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount(route: string) {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  authStore.reset(); // a freshly loaded page: nothing resolved yet
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  refreshDelayMs = 30;
  refreshOk = true;
  stubApi();
});
afterEach(() => configureApiClient(null));

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("AUTH-06 · while the session is being restored (%s) (C1)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
  });

  it("AUTH-06 · an unknown URL shows the loader, never the sign-in form, then says not found", async () => {
    mount("/no-such-admin-page");
    // first paint: the restore is still running
    expect(screen.getByRole("status").textContent).toBe(msgs.auth.restoring);
    expect(screen.queryByRole("heading", { level: 2, name: msgs.auth.loginTitle })).toBeNull();
    expect(screen.queryByLabelText(msgs.auth.email)).toBeNull();

    const heading = await screen.findByRole("heading", { level: 1, name: msgs.shell.notFound });
    expect(heading).toBeTruthy();
    // and the sign-in form was never rendered on the way there
    expect(screen.queryByLabelText(msgs.auth.email)).toBeNull();
  });

  it("AUTH-06 · a known URL shows the loader first, then the page, with no sign-in flash", async () => {
    mount("/products");
    expect(screen.getByRole("status").textContent).toBe(msgs.auth.restoring);
    await screen.findByTestId("sidebar");
    expect(screen.queryByLabelText(msgs.auth.email)).toBeNull();
  });

  it("AUTH-06 · with no session the loader is followed by the sign-in form", async () => {
    refreshOk = false;
    mount("/no-such-admin-page");
    expect(screen.getByRole("status").textContent).toBe(msgs.auth.restoring);
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: msgs.auth.loginTitle })).toBeTruthy());
  });
});

