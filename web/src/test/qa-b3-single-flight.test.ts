// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiRequest, configureApiClient, refreshSession } from "@/lib/api/client";
import { useAuthStore } from "@/lib/auth/store";
import { GUEST_KEY } from "@/lib/cart/guest";
import { hydrateGuest, resetCartStore, resolveGuestProducts, useCartStore } from "@/lib/cart/store";

/**
 * QA 2026-11-24 (B3). Concurrent 401s must share one refresh, nothing may ask for the CSRF token
 * twice at the same time, and the cart must not fetch the same product once per mounted view. A
 * refresh that is overtaken by a sign-out must also drop its result instead of resurrecting the
 * session that just ended - the race behind the admin test flake reported with batch A.
 */
const user = {
  id: "u1",
  firstName: "A",
  lastName: "B",
  email: "a@b.co",
  role: "CUSTOMER",
  isVerified: true,
  isBlocked: false,
  preferredLocale: "en" as const,
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let paths: string[] = [];
type Handler = (path: string, init: RequestInit) => Response | undefined;
function setup(handler: Handler, delayMs = 0) {
  paths = [];
  configureApiClient({
    getLocale: () => "en",
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      paths.push(path);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return handler(path, init ?? {}) ?? json(404, { code: "NOT_FOUND" });
    }) as unknown as typeof fetch,
  });
}
const countOf = (p: string) => paths.filter((x) => x === p).length;

beforeEach(() => {
  window.localStorage.clear();
  resetCartStore();
  useAuthStore.getState().clear();
});
afterEach(() => configureApiClient(null));

describe("AUTH-05 · one refresh for many 401s (B3)", () => {
  it("AUTH-05 · five concurrent 401s share one refresh and one CSRF fetch", async () => {
    useAuthStore.getState().setSession({ accessToken: "old", user });
    let refreshes = 0;
    setup((path, init) => {
      if (path === "/auth/csrf") return json(200, { csrfToken: "c1" });
      if (path === "/auth/refresh") {
        refreshes += 1;
        return refreshes === 1 ? json(403, { code: "CSRF_INVALID" }) : json(200, { accessToken: "new", user });
      }
      const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
      return auth === "Bearer new" ? json(200, { ok: true }) : json(401, { code: "UNAUTHORIZED" });
    }, 1);

    const results = await Promise.all(Array.from({ length: 5 }, () => apiRequest<{ ok: boolean }>("/me")));
    expect(results.every((r) => r.ok)).toBe(true);
    // one shared refresh round: the 403 that asks for a token, the token, the retry
    expect(countOf("/auth/refresh")).toBe(2);
    expect(countOf("/auth/csrf")).toBe(1);
    expect(countOf("/me")).toBe(10); // five first tries, five retries
  });

  it("AUTH-05 · concurrent CSRF fetches share one request", async () => {
    setup((path) => (path === "/auth/csrf" ? json(200, { csrfToken: "c1" }) : json(401, { code: "UNAUTHORIZED" })), 1);
    useAuthStore.getState().setSession({ accessToken: "old", user });
    await Promise.allSettled([refreshSession(), refreshSession(), refreshSession()]);
    expect(countOf("/auth/csrf")).toBeLessThanOrEqual(1);
  });

  it("AUTH-05 · a refresh overtaken by a sign-out does not resurrect the session", async () => {
    useAuthStore.getState().setSession({ accessToken: "old", user });
    setup((path) => {
      if (path === "/auth/csrf") return json(200, { csrfToken: "c1" });
      if (path === "/auth/refresh") return json(200, { accessToken: "new", user });
      return undefined;
    }, 5);
    const pending = refreshSession();
    useAuthStore.getState().clear(); // the logout button, while the refresh is still in flight
    await expect(pending).rejects.toThrow();
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("AUTH-05 · a refresh that fails after a sign-in does not clear the new session", async () => {
    useAuthStore.getState().setSession({ accessToken: "old", user });
    setup((path) => {
      if (path === "/auth/csrf") return json(200, { csrfToken: "c1" });
      if (path === "/auth/refresh") return json(401, { code: "UNAUTHORIZED" });
      return undefined;
    }, 5);
    const pending = refreshSession();
    useAuthStore.getState().setSession({ accessToken: "fresh", user: { ...user, id: "u2" } });
    await expect(pending).rejects.toThrow();
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().accessToken).toBe("fresh");
  });
});

describe("CART-01 · each product is fetched once (B3)", () => {
  it("CART-01 · two views resolving the same guest cart fetch each product once", async () => {
    window.localStorage.setItem(
      GUEST_KEY,
      JSON.stringify([
        { productId: "a".repeat(24), slug: "sofa", qty: 1 },
        { productId: "b".repeat(24), slug: "chair", qty: 1 },
      ]),
    );
    setup(
      (path) =>
        path === "/products/sofa"
          ? json(200, { product: { id: "a".repeat(24), slug: "sofa", title: { en: "S", ar: "S" }, type: "NEW", condition: "NEW", price: 1000, stock: 2, images: [] } })
          : path === "/products/chair"
            ? json(200, { product: { id: "b".repeat(24), slug: "chair", title: { en: "C", ar: "C" }, type: "NEW", condition: "NEW", price: 1000, stock: 2, images: [] } })
            : undefined,
      2,
    );
    hydrateGuest();
    // The drawer and the page both ask, like two mounted CartContents.
    await Promise.all([resolveGuestProducts(), resolveGuestProducts(), resolveGuestProducts()]);
    expect(countOf("/products/sofa")).toBe(1);
    expect(countOf("/products/chair")).toBe(1);
    expect(Object.keys(useCartStore.getState().guestProducts)).toHaveLength(2);
  });
});
