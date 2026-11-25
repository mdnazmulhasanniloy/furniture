import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, configureApiClient, refreshSession } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";

/**
 * QA 2026-11-24 (B3). Concurrent 401s share one refresh, the CSRF token is fetched once, and a
 * refresh that is overtaken by a sign-out drops its result instead of resurrecting the session that
 * just ended. That last race is also what made the AUTH-02 tests flaky under full-suite load,
 * reported with batch A: a refresh left in flight by one test cleared or re-created the session of
 * the next one.
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
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let paths: string[] = [];
function setup(handler: (path: string, init: RequestInit) => Response | undefined, delayMs = 0) {
  paths = [];
  configureApiClient({
    getLocale: () => "en",
    fetch: (async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      paths.push(path);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return handler(path, init ?? {}) ?? json(404, { code: "NOT_FOUND" });
    }) as unknown as typeof fetch,
  });
}
const countOf = (p: string) => paths.filter((x) => x === p).length;

beforeEach(() => authStore.clear());
afterEach(() => configureApiClient(null));

describe("AUTH-02 · one refresh for many 401s (B3)", () => {
  it("AUTH-02 · four concurrent 401s share one refresh and one CSRF fetch", async () => {
    authStore.setSession({ accessToken: "old", user: adminUser });
    setup((path, init) => {
      if (path === "/auth/csrf") return json(200, { csrfToken: "c1" });
      if (path === "/auth/refresh") return json(200, { accessToken: "new", user: adminUser });
      const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
      return auth === "Bearer new" ? json(200, { ok: true }) : json(401, { code: "UNAUTHORIZED" });
    }, 1);

    const results = await Promise.all([
      api.get<{ ok: boolean }>("/admin/products?page=1"),
      api.get<{ ok: boolean }>("/admin/categories"),
      api.get<{ ok: boolean }>("/admin/settings"),
      api.get<{ ok: boolean }>("/admin/orders?page=1"),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(countOf("/auth/refresh")).toBe(1);
    expect(countOf("/auth/csrf")).toBe(1);
  });

  it("AUTH-02 · a refresh overtaken by a sign-out does not resurrect the session", async () => {
    authStore.setSession({ accessToken: "old", user: adminUser });
    setup((path) => {
      if (path === "/auth/csrf") return json(200, { csrfToken: "c1" });
      if (path === "/auth/refresh") return json(200, { accessToken: "new", user: adminUser });
      return undefined;
    }, 5);
    const pending = refreshSession();
    authStore.clear(); // the logout button, while the refresh is still in flight
    await expect(pending).rejects.toThrow();
    expect(authStore.get()).toMatchObject({ status: "anonymous", accessToken: null, user: null });
  });

  it("AUTH-02 · a refresh that fails after a new sign-in leaves that session alone", async () => {
    authStore.setSession({ accessToken: "old", user: adminUser });
    setup((path) => {
      if (path === "/auth/csrf") return json(200, { csrfToken: "c1" });
      if (path === "/auth/refresh") return json(401, { code: "UNAUTHORIZED" });
      return undefined;
    }, 5);
    const pending = refreshSession();
    authStore.setSession({ accessToken: "fresh", user: { ...adminUser, id: "u2" } });
    await expect(pending).rejects.toThrow();
    expect(authStore.get()).toMatchObject({ status: "authenticated", accessToken: "fresh" });
  });
});
