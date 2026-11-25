import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
 * T-109 (QA C5, owner copy approved 2026-11-25). The account menu's two dialogs. The API rules they
 * speak to are T-108: the current password is required and a wrong one counts toward the sign-in
 * lockout, the new password follows the shared policy and may not be the current one, and a success
 * keeps this session alive with a fresh token.
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

type Call = { method: string; path: string; body?: Record<string, unknown>; token?: string };
let calls: Call[] = [];
let failNext: { status: number; code: string; headers?: Record<string, string> } | null = null;
function stubApi() {
  calls = [];
  failNext = null;
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path === "/auth/csrf") {
        calls.push({ method, path });
        return json({ csrfToken: "csrf-1" });
      }
      if (path === "/auth/refresh") return json({ accessToken: "at-1", user: adminUser });
      calls.push({ method, path, body, token: headers.Authorization });
      if (failNext) {
        const f = failNext;
        failNext = null;
        return new Response(JSON.stringify({ code: f.code, message: "Raw English API text" }), {
          status: f.status,
          headers: { "Content-Type": "application/json", ...(f.headers ?? {}) },
        });
      }
      if (path === "/auth/change-password") return json({ accessToken: "at-2", user: adminUser });
      if (path === "/me") return json({ ...adminUser, ...body });
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount() {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/products"]}>
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
  stubApi();
});
afterEach(() => configureApiClient(null));

const writes = () => calls.filter((c) => c.method !== "GET");

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-11 · the account menu (%s) (T-109)", (locale, msgs) => {
  const a = msgs.account;
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
  });

  const openMenu = async () => {
    mount();
    await screen.findByTestId("sidebar");
    fireEvent.click(screen.getByTestId("avatar-button"));
  };
  const openPassword = async () => {
    await openMenu();
    fireEvent.click(screen.getByTestId("account-password-open"));
    return screen.findByTestId("account-password-dialog");
  };
  const fill = (id: string, value: string) =>
    fireEvent.change(document.querySelector(`#${id}`) as HTMLInputElement, { target: { value } });
  const submitPassword = async () => {
    await act(async () => {
      fireEvent.click(screen.getByTestId("account-password-submit"));
    });
  };

  it("ADM-11 · the menu offers Profile and Change password above Sign out", async () => {
    await openMenu();
    const menu = screen.getByRole("menu");
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((b) => b.textContent);
    expect(items).toEqual([a.profile, a.changePassword, msgs.shell.logout]);
  });

  it("ADM-11 · change password sends only the two passwords, keeps the session and confirms", async () => {
    await openPassword();
    fill("acc-current", "OldPassw0rd!");
    fill("acc-new", "NewPassw0rd!");
    fill("acc-confirm", "NewPassw0rd!");
    await submitPassword();

    const put = writes().find((c) => c.path === "/auth/change-password")!;
    expect(put.method).toBe("POST");
    expect(put.body).toEqual({ currentPassword: "OldPassw0rd!", newPassword: "NewPassw0rd!" });
    // The fresh session is held, and the CSRF token is primed again for the new family.
    expect(authStore.get().accessToken).toBe("at-2");
    expect(calls.filter((c) => c.path === "/auth/csrf").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByTestId("account-password-dialog")).toBeNull());
    expect((await screen.findByTestId("account-notice")).textContent).toBe(a.passwordSaved);
  });

  it("ADM-11 · empty fields, a weak new password and a mismatch are refused before sending", async () => {
    await openPassword();
    await submitPassword();
    expect(screen.getAllByText(msgs.auth.required).length).toBeGreaterThanOrEqual(3);
    expect(writes()).toHaveLength(0);

    fill("acc-current", "OldPassw0rd!");
    fill("acc-new", "weakpassword");
    fill("acc-confirm", "weakpassword");
    await submitPassword();
    expect(screen.getByText(msgs.auth.passwordWeak)).toBeTruthy();
    expect(writes()).toHaveLength(0);

    fill("acc-new", "NewPassw0rd!");
    fill("acc-confirm", "NewPassw0rd?");
    await submitPassword();
    expect(screen.getByText(a.mismatch)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("ADM-11 · a new password equal to the current one is refused before sending", async () => {
    await openPassword();
    fill("acc-current", "OldPassw0rd!");
    fill("acc-new", "OldPassw0rd!");
    fill("acc-confirm", "OldPassw0rd!");
    await submitPassword();
    expect(screen.getByText(a.sameAsCurrent)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("ADM-11 · the live checklist ticks the rules of the new password", async () => {
    await openPassword();
    const met = () =>
      [...screen.getByTestId("password-rules").querySelectorAll("li")].map(
        (li) => li.getAttribute("data-met") === "true",
      );
    expect(met()).toEqual([false, false, false, false, false]);
    fill("acc-new", "Passw0rd!");
    await waitFor(() => expect(met()).toEqual([true, true, true, true, true]));
  });

  it("ADM-11 · a wrong current password is shown on that field, never as the shared email message", async () => {
    await openPassword();
    fill("acc-current", "Wr0ngPassword!");
    fill("acc-new", "NewPassw0rd!");
    fill("acc-confirm", "NewPassw0rd!");
    failNext = { status: 401, code: "INVALID_CREDENTIALS" };
    await submitPassword();
    expect(screen.getByText(a.currentWrong)).toBeTruthy();
    expect(screen.queryByText(msgs.errors.INVALID_CREDENTIALS)).toBeNull();
    expect(document.body.textContent).not.toContain("Raw English API text");
    expect(screen.getByTestId("account-password-dialog")).toBeTruthy(); // stays open to retry
  });

  it("ADM-11 · the API's SAME_PASSWORD lands on the new-password field", async () => {
    await openPassword();
    fill("acc-current", "OldPassw0rd!");
    fill("acc-new", "NewPassw0rd!");
    fill("acc-confirm", "NewPassw0rd!");
    failNext = { status: 422, code: "SAME_PASSWORD" };
    await submitPassword();
    expect(screen.getAllByText(a.sameAsCurrent).length).toBeGreaterThan(0);
  });

  it("ADM-11 · the lockout is shown localized with its retry wait", async () => {
    await openPassword();
    fill("acc-current", "Wr0ngPassword!");
    fill("acc-new", "NewPassw0rd!");
    fill("acc-confirm", "NewPassw0rd!");
    failNext = { status: 429, code: "ACCOUNT_LOCKED", headers: { "Retry-After": "900" } };
    await submitPassword();
    const error = await screen.findByTestId("account-password-error");
    expect(error.textContent?.startsWith(msgs.errors.ACCOUNT_LOCKED)).toBe(true);
    expect(error.textContent?.length).toBeGreaterThan(msgs.errors.ACCOUNT_LOCKED.length); // + the wait
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("ADM-11 · profile saves the name, updates the menu and shows the email as read-only", async () => {
    await openMenu();
    fireEvent.click(screen.getByTestId("account-profile-open"));
    await screen.findByTestId("account-profile-dialog");
    const email = screen.getByTestId("account-email") as HTMLInputElement;
    expect(email.value).toBe(adminUser.email);
    expect(email.readOnly).toBe(true);
    expect(screen.getByText(a.emailFixed)).toBeTruthy();

    fill("acc-first", "Noura");
    fill("acc-last", "Alqahtani");
    await act(async () => {
      fireEvent.click(screen.getByTestId("account-profile-submit"));
    });
    const patch = writes().find((c) => c.path === "/me")!;
    expect(patch.method).toBe("PATCH");
    expect(patch.body).toEqual({ firstName: "Noura", lastName: "Alqahtani" });
    await waitFor(() => expect(screen.queryByTestId("account-profile-dialog")).toBeNull());
    expect((await screen.findByTestId("account-notice")).textContent).toBe(a.profileSaved);
    // The avatar initials follow the new name at once.
    expect(screen.getByTestId("avatar-button").textContent).toBe("NA");
    expect(authStore.get().user?.firstName).toBe("Noura");
  });

  it("ADM-11 · an empty name is refused before sending", async () => {
    await openMenu();
    fireEvent.click(screen.getByTestId("account-profile-open"));
    await screen.findByTestId("account-profile-dialog");
    fill("acc-first", "   ");
    await act(async () => {
      fireEvent.click(screen.getByTestId("account-profile-submit"));
    });
    expect(screen.getByText(msgs.admins.form.errors.required)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });
});
