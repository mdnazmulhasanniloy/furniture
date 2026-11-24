import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
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
 * QA 2026-11-25 (C2). An empty email was answered "Enter a valid email address", because the field
 * only had the email-shape check: an empty string fails that too. Every admin email field now says
 * "required" first and keeps the shape message for text that is really not an address.
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

let signedIn = false;
function stubApi() {
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string) => {
      const p = url.replace(/^.*\/api\/v1/, "");
      if (p === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (p === "/auth/refresh")
        return signedIn ? json({ accessToken: "at-1", user: adminUser }) : json({ code: "UNAUTHORIZED" }, 401);
      if (p === "/admin/admins") return json([]);
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
          <App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  authStore.reset();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  signedIn = false;
  stubApi();
});
afterEach(() => configureApiClient(null));

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("AUTH-02 · an empty email says required first (%s) (C2)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
  });
  // The label wraps the field and its error, so once an error is shown the accessible name changes:
  // these forms are addressed by input type, like the other admin auth tests.
  const field = (selector: string) => document.querySelector<HTMLInputElement>(`form ${selector}`)!;
  const type = (selector: string, value: string) =>
    fireEvent.change(field(selector), { target: { value } });

  it("AUTH-02 · sign in: empty email -> required, text that is not an address -> invalid", async () => {
    mount("/login");
    await screen.findByRole("heading", { level: 2, name: msgs.auth.loginTitle });
    type("input[type=password]", "Secret123");
    await act(async () => {
      fireEvent.submit(document.querySelector("form")!);
    });
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent)).toContain(msgs.auth.required);
    expect(screen.queryByText(msgs.auth.invalidEmail)).toBeNull();

    type("input[type=email]", "not-an-address");
    await act(async () => {
      fireEvent.submit(document.querySelector("form")!);
    });
    expect(await screen.findByText(msgs.auth.invalidEmail)).toBeTruthy();
  });

  it("AUTH-03 · accept invite: an email cleared by hand -> required", async () => {
    mount("/accept-invite?email=new%40furnixa.test");
    await screen.findByRole("heading", { level: 2, name: msgs.auth.inviteTitle });
    type("input[type=email]", "");
    await act(async () => {
      fireEvent.submit(document.querySelector("form")!);
    });
    expect((await screen.findAllByRole("alert")).map((a) => a.textContent)).toContain(msgs.auth.required);
    expect(screen.queryByText(msgs.auth.invalidEmail)).toBeNull();
  });

  it("ADM-11 · invite an admin: an empty email -> required, like the two names", async () => {
    signedIn = true;
    mount("/admins");
    fireEvent.click(await screen.findByTestId("admin-invite-open"));
    const dialog = await screen.findByTestId("admin-invite-dialog");
    fireEvent.click(screen.getByTestId("admin-invite-submit"));
    const required = await within(dialog).findAllByText(msgs.admins.form.errors.required);
    expect(required).toHaveLength(3); // first name, last name, email
    expect(within(dialog).queryByText(msgs.admins.form.errors.invalidEmail)).toBeNull();
  });
});
