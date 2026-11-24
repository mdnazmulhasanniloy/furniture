// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const push = vi.fn();
const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push, replace }),
  usePathname: () => "/login",
}));

import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { configureApiClient, refreshSession } from "@/lib/api/client";
import { safeNext } from "@/lib/auth/next-path";
import { useAuthStore } from "@/lib/auth/store";

/**
 * QA 2026-11-24 (B2). Opening /login or /register while already signed in left the visitor on the
 * form and, once the session was restored, dropped them on the home page; and the client asked for a
 * CSRF token before it knew whether a session existed at all, so every guest's first page load made a
 * doomed GET /auth/csrf (its 401 is correct by design). Now the refresh comes first, the CSRF token is
 * only fetched when the API says the request needs one, and a signed-in visitor goes to the account
 * page or to a `next` path that is same-origin.
 */
const messages = { en, ar } as const;
const wrap = (locale: "en" | "ar", ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );

type Call = { path: string; method: string; csrf: string | undefined };
let calls: Call[] = [];
let refreshAnswer: () => Response;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const session = {
  accessToken: "tok",
  user: {
    id: "1",
    firstName: "A",
    lastName: "B",
    email: "a@b.co",
    role: "CUSTOMER",
    isVerified: true,
    isBlocked: false,
    preferredLocale: "en" as const,
  },
};

beforeEach(() => {
  calls = [];
  push.mockClear();
  replace.mockClear();
  refreshAnswer = () => json(401, { code: "UNAUTHORIZED" });
  useAuthStore.getState().clear();
  configureApiClient({
    getLocale: () => "en",
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ path, method: init?.method ?? "GET", csrf: headers["X-CSRF-Token"] });
      if (path === "/auth/csrf") return json(200, { csrfToken: "csrf-1" });
      if (path === "/auth/refresh") return refreshAnswer();
      if (path === "/auth/login") return json(200, session);
      return json(200, { message: "ok" });
    }) as unknown as typeof fetch,
  });
});
afterEach(() => {
  cleanup();
  configureApiClient(null);
});

describe("AUTH-05 · the client never asks for a CSRF token without a session (B2)", () => {
  it("AUTH-05 · a guest refresh makes one request and no /auth/csrf call", async () => {
    await expect(refreshSession()).rejects.toThrow();
    expect(calls.map((c) => c.path)).toEqual(["/auth/refresh"]);
    expect(calls[0]!.csrf).toBeUndefined();
    expect(useAuthStore.getState().status).toBe("anonymous");
  });

  it("AUTH-05 · a session whose refresh needs CSRF recovers by fetching it once", async () => {
    let asked = 0;
    refreshAnswer = () => (++asked === 1 ? json(403, { code: "CSRF_INVALID" }) : json(200, session));
    await refreshSession();
    expect(calls.map((c) => c.path)).toEqual(["/auth/refresh", "/auth/csrf", "/auth/refresh"]);
    expect(calls[2]!.csrf).toBe("csrf-1");
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("AUTH-05 · a cached CSRF token is sent straight away (one request)", async () => {
    useAuthStore.getState().setCsrfToken("cached");
    refreshAnswer = () => json(200, session);
    await refreshSession();
    expect(calls.map((c) => c.path)).toEqual(["/auth/refresh"]);
    expect(calls[0]!.csrf).toBe("cached");
  });
});

describe("AUTH-05 · safeNext keeps redirects on this site (B2)", () => {
  it("AUTH-05 · same-origin paths pass, everything else is dropped", () => {
    expect(safeNext("/cart", "en")).toBe("/cart");
    expect(safeNext("/account/orders", "ar")).toBe("/account/orders");
    expect(safeNext("/en/cart", "en")).toBe("/cart"); // the localized router adds the prefix itself
    expect(safeNext("/ar/cart", "ar")).toBe("/cart");
    expect(safeNext("/shop?type=new", "en")).toBe("/shop?type=new");
    for (const bad of [
      "//evil.test/x",
      "https://evil.test",
      "http://evil.test",
      "javascript:alert(1)",
      "/\\evil.test",
      "/cart\nx",
      "cart",
      "",
      null,
      undefined,
    ]) {
      expect(safeNext(bad, "en"), String(bad)).toBeNull();
    }
  });
});

for (const locale of ["en", "ar"] as const) {
  describe(`AUTH-02 · the auth pages when the visitor is already signed in (${locale}) (B2)`, () => {
    const signedIn = () =>
      useAuthStore.setState({ status: "authenticated", accessToken: "t", user: session.user as never });

    it(`AUTH-02 · /login sends a signed-in visitor to the account page (${locale})`, async () => {
      signedIn();
      wrap(locale, <LoginForm />);
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/account"));
    });

    it(`AUTH-02 · /register sends a signed-in visitor to the account page (${locale})`, async () => {
      signedIn();
      wrap(locale, <RegisterForm />);
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/account"));
    });

    it(`AUTH-02 · a same-origin next wins, a foreign one is ignored (${locale})`, async () => {
      signedIn();
      const { unmount } = wrap(locale, <LoginForm next="/cart" />);
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/cart"));
      unmount();
      replace.mockClear();
      wrap(locale, <LoginForm next="https://evil.test/steal" />);
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/account"));
    });

    it(`AUTH-02 · while the session is still unknown the form is shown, not a redirect (${locale})`, async () => {
      useAuthStore.setState({ status: "unknown", accessToken: null, user: null });
      wrap(locale, <LoginForm />);
      expect(screen.getByLabelText(messages[locale].auth.email)).toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
    });

    it(`AUTH-02 · a fresh login honours a same-origin next, and lands on the home page without one (${locale})`, async () => {
      const m = messages[locale].auth;
      const { unmount } = wrap(locale, <LoginForm next="/cart" />);
      fireEvent.change(screen.getByLabelText(m.email), { target: { value: "a@b.co" } });
      fireEvent.change(screen.getByLabelText(m.password), { target: { value: "Passw0rd!" } });
      fireEvent.click(screen.getByRole("button", { name: m.login }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/cart"));
      unmount();
      replace.mockClear();
      useAuthStore.getState().clear();

      wrap(locale, <LoginForm />);
      fireEvent.change(screen.getByLabelText(m.email), { target: { value: "a@b.co" } });
      fireEvent.change(screen.getByLabelText(m.password), { target: { value: "Passw0rd!" } });
      fireEvent.click(screen.getByRole("button", { name: m.login }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    });
  });
}
