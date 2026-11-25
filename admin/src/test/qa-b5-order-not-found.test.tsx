import { render, screen, waitFor, within } from "@testing-library/react";
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
 * QA 2026-11-24 (B5). An order id that does not exist showed the generic "item no longer exists"
 * error with a Retry button, and the request was retried once because the app retried every failed
 * query. A 4xx is an answer, not a hiccup: it is not retried, and the page says the order is not there
 * and offers the way back to the list. 5xx and network failures are still retried once.
 *
 * The App is mounted without a QueryClient on purpose, so these tests run against the app's own
 * retry policy rather than a test-local one.
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

let paths: string[] = [];
let orderAnswer: () => Response;
function stubApi() {
  paths = [];
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string) => {
      const p = url.replace(/^.*\/api\/v1/, "");
      paths.push(p);
      if (p === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (p === "/auth/refresh") return json({ accessToken: "at-1", user: adminUser });
      if (p.startsWith("/admin/orders/")) return orderAnswer();
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}
const orderCalls = () => paths.filter((p) => p.startsWith("/admin/orders/"));

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
  authStore.clear();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  orderAnswer = () => json({ code: "NOT_FOUND", message: "Raw English API text" }, 404);
  stubApi();
});
afterEach(() => configureApiClient(null));

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-04 · an unknown order id (%s) (B5)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
  });

  it("ADM-04 · shows a not-found state with the way back, and does not retry the 404", async () => {
    mount("/orders/0123456789abcdef01234567");
    const box = await screen.findByTestId("order-not-found");
    expect(box.textContent).toContain(msgs.orders.notFound);
    expect(within(box).getByRole("link", { name: msgs.orders.back }).getAttribute("href")).toBe("/orders");
    expect(screen.queryByRole("button", { name: msgs.orders.retry })).toBeNull();
    expect(document.body.textContent).not.toContain("Raw English API text");
    // A 4xx is the answer: asked once, never retried.
    await new Promise((r) => setTimeout(r, 50));
    expect(orderCalls()).toHaveLength(1);
  });

  it("ADM-04 · a 500 is still retried once and offers Retry", async () => {
    orderAnswer = () => json({ code: "INTERNAL_ERROR" }, 500);
    mount("/orders/0123456789abcdef01234567");
    await screen.findByTestId("order-error", undefined, { timeout: 4000 }); // one retry with backoff first
    expect(screen.getByRole("button", { name: msgs.orders.retry })).toBeTruthy();
    await waitFor(() => expect(orderCalls().length).toBe(2), { timeout: 4000 });
    expect(screen.queryByTestId("order-not-found")).toBeNull();
  });
});
