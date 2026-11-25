// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/account",
}));

import { AccountShell } from "@/components/account/account-shell";
import { SessionReset } from "@/components/auth/session-reset";
import { configureApiClient } from "@/lib/api/client";
import { useAuthStore } from "@/lib/auth/store";

/**
 * QA 2026-11-24 (A5), storefront half. After signing out, Back could still paint an account page from
 * the session that had just ended: the Next router cache keeps the rendered payload, and a document
 * restored from the back/forward cache brings the whole old heap back. Signing out now refreshes the
 * router cache and drops any cached query data, and a restored page re-checks with the server.
 */
const messages = { en, ar } as const;
const customer = {
  id: "u1",
  firstName: "Sara",
  lastName: "Ali",
  email: "sara@x.sa",
  role: "CUSTOMER",
  phone: null,
  avatarUrl: null,
  isVerified: true,
  isBlocked: false,
  preferredLocale: "ar",
  createdAt: "2026-11-01T00:00:00.000Z",
};
const signedIn = () =>
  useAuthStore.setState({ status: "authenticated", accessToken: "at-1", csrfToken: "c-1", user: customer as never });

let refreshOk = true;
const stub = () => {
  refreshOk = true;
  configureApiClient({
    getLocale: () => "en",
    fetch: (async (url: string) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      if (path === "/auth/refresh" && !refreshOk) {
        return new Response(JSON.stringify({ code: "UNAUTHORIZED" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/auth/refresh") {
        return new Response(JSON.stringify({ accessToken: "at-2", user: customer }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });
};

const wrap = (locale: "en" | "ar", ui: React.ReactNode, client = new QueryClient()) =>
  render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  refresh.mockClear();
  replace.mockClear();
  useAuthStore.getState().clear();
  stub();
});
afterEach(() => {
  cleanup();
  configureApiClient(null);
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("PROF-01 · signing out leaves no account page behind (%s) (A5)", (locale, m) => {
  it("PROF-01 · the session ending clears cached data and refreshes the router cache (A5)", async () => {
    signedIn();
    const client = new QueryClient();
    client.setQueryData(["account", "orders"], [{ orderNo: "FX-20261124-0042" }]);
    wrap(locale, <SessionReset />, client);
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      useAuthStore.getState().clear(); // what the logout button ends with
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it("PROF-01 · an open account page hides its content and sends the guest to /login (A5)", async () => {
    signedIn();
    wrap(
      locale,
      <>
        <SessionReset />
        <AccountShell tab="profile">
          <p>order FX-20261124-0042</p>
        </AccountShell>
      </>,
    );
    expect(screen.getByText("order FX-20261124-0042")).toBeTruthy();
    await act(async () => {
      useAuthStore.getState().clear();
    });
    expect(screen.queryByText("order FX-20261124-0042")).toBeNull();
    expect(replace).toHaveBeenCalledWith("/login");
    expect(screen.getByText(m.account.loading)).toBeTruthy();
  });

  it("PROF-01 · a page restored from the back/forward cache re-checks the session (A5)", async () => {
    signedIn();
    wrap(locale, <SessionReset />);
    refreshOk = false; // the session was ended elsewhere while this document was in the cache
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await waitFor(() => expect(useAuthStore.getState().status).toBe("anonymous"));
    expect(refresh).toHaveBeenCalledTimes(1); // and the stale router cache goes with it
  });

  it("PROF-01 · a restore while the session is still alive keeps the customer signed in (A5)", async () => {
    signedIn();
    wrap(locale, <SessionReset />);
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(refresh).not.toHaveBeenCalled();
  });
});
