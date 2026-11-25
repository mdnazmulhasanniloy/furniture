import { render, screen } from "@testing-library/react";
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
 * QA 2026-11-25 (C3). The Arabic dashboard name wrapped onto a second line in the sidebar header.
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
] as const)("UI-01 · the sidebar name stays on one line (%s) (C3)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
  });

  /**
   * jsdom has no layout, so this asserts the contract that keeps it on one line: no wrapping, the
   * overflow clipped with an ellipsis, and the full name still reachable as a tooltip.
   */
  it("UI-01 · the dashboard name does not wrap", async () => {
    mount("/");
    await screen.findByTestId("sidebar");
    const name = screen.getByTestId("sidebar-title");
    expect(name.textContent).toBe(msgs.app.title);
    expect(name.className).toContain("whitespace-nowrap");
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("min-w-0");
    expect(name.getAttribute("title")).toBe(msgs.app.title);
  });
});
