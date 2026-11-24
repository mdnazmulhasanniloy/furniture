import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest, configureApiClient } from "@/lib/api/client";
import { ApiError, apiErrorMessage } from "@/lib/api/errors";
import { login, logout, restoreSession } from "@/lib/auth/session";
import { useAuthStore } from "@/lib/auth/store";

const messages = {
  en: JSON.parse(readFileSync(path.resolve(__dirname, "../../messages/en.json"), "utf8")),
  ar: JSON.parse(readFileSync(path.resolve(__dirname, "../../messages/ar.json"), "utf8")),
};

const user = {
  id: "a".repeat(24),
  firstName: "A",
  lastName: "B",
  email: "a@b.sa",
  role: "CUSTOMER",
  isVerified: true,
  isBlocked: false,
  preferredLocale: "ar" as const,
};

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };

function setup(handler: (call: Call, n: number) => Response | Promise<Response>, locale = "en") {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: Call["init"]) => {
    const call = { url, init };
    calls.push(call);
    return handler(call, calls.length);
  });
  configureApiClient({ fetch: fetchMock as unknown as typeof fetch, getLocale: () => locale });
  return calls;
}

const countOf = (calls: Call[], suffix: string) => calls.filter((c) => c.url.endsWith(suffix)).length;

beforeEach(() => {
  useAuthStore.setState({ status: "unknown", accessToken: null, csrfToken: null, user: null });
});
afterEach(() => configureApiClient(null));

describe("AUTH-05 · fetch wrapper", () => {
  it.each(["en", "ar"])("AUTH-05 · sends Accept-Language %s, Bearer token, same-origin base path", async (locale) => {
    useAuthStore.getState().setSession({ accessToken: "tok", user });
    const calls = setup(() => json(200, { ok: true }), locale);
    await apiRequest("/me");
    expect(calls[0].url).toBe("/api/v1/me");
    expect(calls[0].init.headers["Accept-Language"]).toBe(locale);
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(calls[0].init.credentials).toBe("same-origin");
  });

  it("AUTH-05 · access token is kept in memory only (no web storage)", async () => {
    const set = vi.fn();
    vi.stubGlobal("localStorage", { setItem: set, getItem: () => null });
    vi.stubGlobal("sessionStorage", { setItem: set, getItem: () => null });
    setup((c) =>
      c.url.endsWith("/auth/login")
        ? json(200, { accessToken: "secret-token", user })
        : json(200, { csrfToken: "csrf1" }),
    );
    await login("a@b.sa", "pw");
    expect(useAuthStore.getState().accessToken).toBe("secret-token");
    expect(set).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("AUTH-05 · login caches the CSRF token fetched after login", async () => {
    const calls = setup((c) =>
      c.url.endsWith("/auth/login")
        ? json(200, { accessToken: "t1", user })
        : json(200, { csrfToken: "csrf1" }),
    );
    await login("a@b.sa", "pw");
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/auth/login", "/api/v1/auth/csrf"]);
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(useAuthStore.getState().csrfToken).toBe("csrf1");
  });
});

describe("AUTH-05 · 401 -> single refresh -> retry once", () => {
  it("AUTH-05 · concurrent 401s share ONE refresh call (single-flight) and each retries once", async () => {
    useAuthStore.getState().setSession({ accessToken: "old", user });
    useAuthStore.getState().setCsrfToken("csrf1");
    const calls = setup((c) => {
      if (c.url.endsWith("/auth/refresh")) return json(200, { accessToken: "new", user });
      return c.init.headers.Authorization === "Bearer new"
        ? json(200, { ok: true })
        : json(401, { code: "UNAUTHORIZED", message: "x" });
    });
    const results = await Promise.all([apiRequest("/a"), apiRequest("/b"), apiRequest("/c")]);
    expect(results).toHaveLength(3);
    expect(countOf(calls, "/auth/refresh")).toBe(1);
    expect(calls.filter((c) => c.url.endsWith("/auth/refresh"))[0].init.headers["X-CSRF-Token"]).toBe("csrf1");
    expect(calls.filter((c) => /\/[abc]$/.test(c.url))).toHaveLength(6);
    expect(useAuthStore.getState().accessToken).toBe("new");
  });

  // QA B2 (owner 2026-11-24): the token is no longer fetched up front - only a session can be answered
  // CSRF_INVALID, so asking first meant a guest's page load made a GET /auth/csrf answered 401 by design.
  it("AUTH-05 · the refresh goes out with no CSRF token and fetches one only when the API asks", async () => {
    let refreshes = 0;
    const calls = setup((c) => {
      if (c.url.endsWith("/auth/csrf")) return json(200, { csrfToken: "csrfX" });
      if (c.url.endsWith("/auth/refresh")) {
        return ++refreshes === 1
          ? json(403, { code: "CSRF_INVALID", message: "x" })
          : json(200, { accessToken: "new", user });
      }
      return c.init.headers.Authorization ? json(200, {}) : json(401, { code: "UNAUTHORIZED", message: "x" });
    });
    await apiRequest("/me");
    expect(countOf(calls, "/auth/refresh")).toBe(2);
    expect(countOf(calls, "/auth/csrf")).toBe(1);
    expect(calls.findIndex((c) => c.url.endsWith("/auth/csrf"))).toBeGreaterThan(
      calls.findIndex((c) => c.url.endsWith("/auth/refresh")),
    );
  });

  it("AUTH-05 · a guest refresh never calls /auth/csrf", async () => {
    const calls = setup((c) =>
      c.url.endsWith("/auth/refresh")
        ? json(401, { code: "UNAUTHORIZED", message: "x" })
        : json(401, { code: "UNAUTHORIZED", message: "x" }),
    );
    await expect(apiRequest("/me")).rejects.toThrow();
    expect(countOf(calls, "/auth/csrf")).toBe(0);
  });

  it("AUTH-05 · a second 401 after the refresh is not retried again (no loop)", async () => {
    useAuthStore.getState().setSession({ accessToken: "old", user });
    useAuthStore.getState().setCsrfToken("c");
    const calls = setup((c) =>
      c.url.endsWith("/auth/refresh")
        ? json(200, { accessToken: "new", user })
        : json(401, { code: "UNAUTHORIZED", message: "x" }),
    );
    await expect(apiRequest("/me")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(countOf(calls, "/me")).toBe(2);
    expect(countOf(calls, "/auth/refresh")).toBe(1);
  });

  it("AUTH-05 · refresh failure (UNAUTHORIZED) clears the session and surfaces the 401", async () => {
    useAuthStore.getState().setSession({ accessToken: "old", user });
    useAuthStore.getState().setCsrfToken("c");
    setup(() => json(401, { code: "UNAUTHORIZED", message: "x" }, {}), "en");
    await expect(apiRequest("/me")).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("AUTH-05 · REFRESH_RACE retries the refresh once and does not log out", async () => {
    useAuthStore.getState().setSession({ accessToken: "old", user });
    useAuthStore.getState().setCsrfToken("c");
    let refreshes = 0;
    const calls = setup((c) => {
      if (c.url.endsWith("/auth/refresh")) {
        refreshes += 1;
        return refreshes === 1
          ? json(401, { code: "REFRESH_RACE", message: "x" })
          : json(200, { accessToken: "new", user });
      }
      return c.init.headers.Authorization === "Bearer new"
        ? json(200, { ok: 1 })
        : json(401, { code: "UNAUTHORIZED", message: "x" });
    });
    await expect(apiRequest("/me")).resolves.toEqual({ ok: 1 });
    expect(countOf(calls, "/auth/refresh")).toBe(2);
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("AUTH-05 · REFRESH_RACE twice keeps the session (no logout)", async () => {
    useAuthStore.getState().setSession({ accessToken: "old", user });
    useAuthStore.getState().setCsrfToken("c");
    setup((c) => json(401, { code: c.url.endsWith("/auth/refresh") ? "REFRESH_RACE" : "UNAUTHORIZED", message: "x" }));
    await expect(apiRequest("/me")).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("AUTH-05 · CSRF_INVALID refetches the CSRF token once and retries the refresh", async () => {
    useAuthStore.getState().setSession({ accessToken: "old", user });
    useAuthStore.getState().setCsrfToken("stale");
    let n = 0;
    const calls = setup((c) => {
      if (c.url.endsWith("/auth/csrf")) return json(200, { csrfToken: "fresh" });
      if (c.url.endsWith("/auth/refresh")) {
        n += 1;
        return n === 1 ? json(403, { code: "CSRF_INVALID", message: "x" }) : json(200, { accessToken: "new", user });
      }
      return c.init.headers.Authorization === "Bearer new" ? json(200, {}) : json(401, { code: "UNAUTHORIZED", message: "x" });
    });
    await apiRequest("/me");
    expect(countOf(calls, "/auth/csrf")).toBe(1);
    expect(useAuthStore.getState().csrfToken).toBe("fresh");
  });

  it("AUTH-05 · restoreSession with no cookie ends anonymous", async () => {
    setup(() => json(401, { code: "UNAUTHORIZED", message: "x" }));
    await restoreSession();
    expect(useAuthStore.getState().status).toBe("anonymous");
  });

  it("AUTH-05 · logout sends the cached CSRF token + Bearer and clears local state even on failure", async () => {
    useAuthStore.getState().setSession({ accessToken: "tok", user });
    useAuthStore.getState().setCsrfToken("csrf1");
    const calls = setup(() => json(500, { code: "INTERNAL_ERROR", message: "x" }));
    await logout();
    expect(calls[0].url).toBe("/api/v1/auth/logout");
    expect(calls[0].init.headers["X-CSRF-Token"]).toBe("csrf1");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().csrfToken).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("AUTH-05 · localized API errors (%s)", (locale) => {
  const t = createTranslator({ locale, messages: messages[locale], namespace: "errors" });
  const tr = t as unknown as (k: string, v?: Record<string, string | number>) => string;

  it("AUTH-05 · INVALID_CREDENTIALS shows the catalogue message, never the API message", () => {
    const e = new ApiError({ status: 401, code: "INVALID_CREDENTIALS", message: "Invalid email or password" });
    const text = apiErrorMessage(tr, e);
    expect(text).toBe(messages[locale].errors.INVALID_CREDENTIALS);
    expect(text).not.toContain("Invalid email or password");
  });

  it("AUTH-05 · unknown code falls back to the generic message", () => {
    expect(apiErrorMessage(tr, new ApiError({ status: 418, code: "WHATEVER", message: "teapot" }))).toBe(
      messages[locale].errors.generic,
    );
  });

  it("AUTH-05 · RATE_LIMITED uses Retry-After (720 s -> 12 minutes)", () => {
    const text = apiErrorMessage(tr, new ApiError({ status: 429, code: "RATE_LIMITED", retryAfterSeconds: 720 }));
    expect(text).toContain(messages[locale].errors.RATE_LIMITED);
    expect(text).toContain("12");
  });

  it("AUTH-05 · ACCOUNT_LOCKED uses Retry-After (rounds up, seconds under a minute)", () => {
    const mins = apiErrorMessage(tr, new ApiError({ status: 429, code: "ACCOUNT_LOCKED", retryAfterSeconds: 601 }));
    expect(mins).toContain("11");
    const secs = apiErrorMessage(tr, new ApiError({ status: 429, code: "ACCOUNT_LOCKED", retryAfterSeconds: 30 }));
    expect(secs).toContain("30");
  });
});

describe("AUTH-05 · exact English wording", () => {
  it("AUTH-05 · 'Try again in 12 minutes'", () => {
    const t = createTranslator({ locale: "en", messages: messages.en, namespace: "errors" });
    const text = apiErrorMessage(
      t as unknown as (k: string, v?: Record<string, string | number>) => string,
      new ApiError({ status: 429, code: "ACCOUNT_LOCKED", retryAfterSeconds: 720 }),
    );
    expect(text).toContain("Try again in 12 minutes.");
  });
});
