import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/**
 * QA 2026-11-24 (A5). After logging out, Back showed the dashboard with the data of the session that
 * had just ended: the access token and the user were cleared, but react-query kept every answer of
 * that session in its cache. Signing out now empties the cache, and a page restored from the
 * back/forward cache re-checks the session with the server instead of trusting the restored heap.
 */
const adminUser = {
  id: "u1",
  firstName: "Sara",
  lastName: "Admin",
  email: "sara@furnixa.test",
  role: "ADMIN",
  isVerified: true,
  isBlocked: false,
  preferredLocale: "ar" as const,
};
const PRODUCT = "Secret oak table";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

let refreshOk = true;
function stubApi() {
  refreshOk = true;
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh")
        return refreshOk
          ? json({ accessToken: "at-1", user: adminUser })
          : json({ code: "UNAUTHORIZED" }, 401);
      if (path === "/auth/logout" && method === "POST") return new Response(null, { status: 204 });
      if (path === "/admin/categories") return json([]);
      if (path.startsWith("/admin/products?")) {
        return json({
          items: [
            {
              id: "p1", title: { en: PRODUCT, ar: PRODUCT }, description: { en: "x", ar: "x" }, slug: "oak",
              sku: null, type: "NEW", condition: "NEW", conditionNotes: null, price: 129900, compareAtPrice: null,
              stock: 3, categoryId: "c1", images: [], dimensions: null, material: null, color: null,
              isFeatured: false, status: "PUBLISHED", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
            },
          ],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mount(path: string, client: QueryClient) {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <App queryClient={client} />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

const signOut = async () => {
  fireEvent.click(screen.getByTestId("avatar-button"));
  await act(async () => {
    fireEvent.click(screen.getByTestId("logout"));
  });
};

beforeEach(() => {
  authStore.clear();
  localStorage.clear();
  localStorage.removeItem(THEME_KEY);
  document.documentElement.classList.remove("dark");
  stubApi();
});
afterEach(() => configureApiClient(null));

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("AUTH-06 · signing out leaves nothing of the session (%s) (A5)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
  });

  it("AUTH-06 · logout empties the query cache and the in-memory session (A5)", async () => {
    const client = newClient();
    const { unmount } = mount("/products", client);
    expect(await screen.findByText(PRODUCT)).toBeTruthy();
    expect(client.getQueryCache().getAll().length).toBeGreaterThan(0);

    await signOut();
    expect(await screen.findByRole("heading", { level: 2, name: msgs.auth.loginTitle })).toBeTruthy();
    expect(client.getQueryCache().getAll()).toEqual([]);
    expect(authStore.get()).toMatchObject({ accessToken: null, csrfToken: null, user: null, status: "anonymous" });
    expect(document.body.textContent).not.toContain(PRODUCT);

    // Back to the dashboard route: the guard re-checks, and nothing of the old session is left to paint.
    unmount();
    refreshOk = false; // the refresh cookie is gone with the session
    mount("/products", client);
    expect(await screen.findByRole("heading", { level: 2, name: msgs.auth.loginTitle })).toBeTruthy();
    expect(document.body.textContent).not.toContain(PRODUCT);
  });

  it("AUTH-06 · a page restored from the back/forward cache re-checks the session (A5)", async () => {
    const client = newClient();
    mount("/products", client);
    expect(await screen.findByText(PRODUCT)).toBeTruthy();

    // The session was ended elsewhere (another tab, or the server), then this document is restored.
    refreshOk = false;
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await waitFor(() => expect(authStore.get().status).toBe("anonymous"));
    expect(await screen.findByRole("heading", { level: 2, name: msgs.auth.loginTitle })).toBeTruthy();
    expect(client.getQueryCache().getAll()).toEqual([]);
  });
});
