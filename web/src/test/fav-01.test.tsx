// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/lib/cart/store", () => ({ addToCart: vi.fn(async () => true) }));

import { FavouritesLink } from "@/components/favourites/favourites-link";
import { FavouritesPage } from "@/components/favourites/favourites-page";
import { FavouritesSync } from "@/components/favourites/favourites-sync";
import { ConnectedProductCard } from "@/components/favourites/connected-card";
import { configureApiClient } from "@/lib/api/client";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";
import { GUEST_FAV_KEY, MAX_FAVOURITES } from "@/lib/favourites/guest";
import {
  hydrateGuestFavourites,
  loadFavourites,
  resetFavouritesStore,
  syncFavouritesAfterLogin,
  toggleFavourite,
  useFavouritesStore,
} from "@/lib/favourites/store";

const messages = { en, ar } as const;
type L = "en" | "ar";

const product = (n: number, over: Partial<HomeProduct> = {}): HomeProduct => ({
  id: `id${n}`,
  slug: `slug-${n}`,
  title: { en: `Chair ${n}`, ar: `كرسي ${n}` },
  type: "NEW",
  condition: "NEW",
  price: 10000,
  compareAtPrice: null,
  stock: 3,
  images: [],
  ...over,
});

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const wishlist = (ps: HomeProduct[]) => ({ productIds: ps.map((p) => p.id), items: ps, total: ps.length });

type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];
let respond: (c: Call) => Response | Promise<Response>;

const asCustomer = () =>
  useAuthStore.getState().setSession({
    accessToken: "tok",
    user: { id: "u1", firstName: "A", lastName: "B", email: "a@b.co", role: "CUSTOMER", isVerified: true, isBlocked: false, preferredLocale: "en" },
  });
const asAdmin = () =>
  useAuthStore.getState().setSession({
    accessToken: "tok",
    user: { id: "u2", firstName: "A", lastName: "B", email: "a@b.co", role: "ADMIN", isVerified: true, isBlocked: false, preferredLocale: "en" },
  });
const stored = () => JSON.parse(window.localStorage.getItem(GUEST_FAV_KEY) ?? "[]") as { productId: string }[];

beforeEach(() => {
  calls = [];
  window.localStorage.clear();
  resetFavouritesStore();
  useAuthStore.getState().clear();
  respond = () => json(200, wishlist([]));
  configureApiClient({
    getLocale: () => "en",
    fetch: vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const c: Call = {
        method: init?.method ?? "GET",
        path: String(url).replace("/api/v1", ""),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(c);
      return respond(c);
    }) as unknown as typeof fetch,
  });
});
afterEach(() => {
  cleanup();
  configureApiClient(null);
});

const wrap = (locale: L, ui: React.ReactNode) => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
};

describe("FAV-01 · guest favourites (localStorage)", () => {
  it("FAV-01 · toggling stores id and slug locally and toggling again removes it", async () => {
    await toggleFavourite(product(1));
    await toggleFavourite(product(2));
    expect(stored().map((s) => s.productId)).toEqual(["id1", "id2"]);
    await toggleFavourite(product(1));
    expect(stored().map((s) => s.productId)).toEqual(["id2"]);
    expect(calls).toEqual([]); // guests never call the API
  });

  it("FAV-01 · at 100 an add is refused with the full flag and nothing is stored", async () => {
    window.localStorage.setItem(
      GUEST_FAV_KEY,
      JSON.stringify(Array.from({ length: MAX_FAVOURITES }, (_, i) => ({ productId: `x${i}`, slug: `s${i}` }))),
    );
    hydrateGuestFavourites();
    await toggleFavourite(product(500));
    expect(useFavouritesStore.getState().full).toBe(true);
    expect(stored()).toHaveLength(100);
  });

  it("FAV-01 · corrupt or foreign localStorage content is ignored", () => {
    window.localStorage.setItem(GUEST_FAV_KEY, "{not json");
    hydrateGuestFavourites();
    expect(useFavouritesStore.getState().guest).toEqual([]);
    window.localStorage.setItem(GUEST_FAV_KEY, JSON.stringify([{ productId: "ok", slug: "s" }, { productId: "<x>", slug: "s" }, 5]));
    hydrateGuestFavourites();
    expect(useFavouritesStore.getState().guest.map((g) => g.productId)).toEqual(["ok"]);
  });

  it("FAV-01 · an admin session keeps the guest list and never calls /me/wishlist", async () => {
    asAdmin();
    await toggleFavourite(product(1));
    expect(stored()).toHaveLength(1);
    expect(calls).toEqual([]);
  });
});

describe("FAV-01 · account favourites (per-item, optimistic)", () => {
  it("FAV-01 · add is PUT /me/wishlist/{id}, remove is DELETE, the API list wins", async () => {
    asCustomer();
    respond = (c) => json(200, wishlist(c.method === "PUT" ? [product(1)] : []));
    await toggleFavourite(product(1));
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/me/wishlist/id1" });
    expect(useFavouritesStore.getState().ids).toEqual(["id1"]);
    await toggleFavourite(product(1));
    expect(calls[1]).toMatchObject({ method: "DELETE", path: "/me/wishlist/id1" });
    expect(useFavouritesStore.getState().ids).toEqual([]);
  });

  it("FAV-01 · a failed write rolls the heart back and keeps the error code", async () => {
    asCustomer();
    respond = () => json(500, { code: "INTERNAL_ERROR", message: "x" });
    await toggleFavourite(product(1));
    expect(useFavouritesStore.getState().ids).toEqual([]);
    expect(useFavouritesStore.getState().error).toBe("INTERNAL_ERROR");
  });

  it("FAV-01 · WISHLIST_LIMIT_REACHED from the API shows the full flag", async () => {
    asCustomer();
    respond = () => json(409, { code: "WISHLIST_LIMIT_REACHED", message: "x" });
    await toggleFavourite(product(1));
    expect(useFavouritesStore.getState().full).toBe(true);
    expect(useFavouritesStore.getState().ids).toEqual([]);
  });

  it("FAV-01 · a slow older GET /me/wishlist does not overwrite a newer one", async () => {
    asCustomer();
    const gates: (() => void)[] = [];
    respond = () => {
      const n = gates.length;
      return new Promise<Response>((resolve) => gates.push(() => resolve(json(200, wishlist([product(n)])))));
    };
    const a = loadFavourites();
    const b = loadFavourites();
    gates[1]!(); // the newer request (product 1) answers first
    await b;
    gates[0]!();
    await a;
    expect(useFavouritesStore.getState().ids).toHaveLength(1);
    expect(useFavouritesStore.getState().ids[0]).toBe("id1"); // the older answer (id0) was ignored
  });
});

describe("FAV-01 · merge after login", () => {
  const seed = () => {
    window.localStorage.setItem(GUEST_FAV_KEY, JSON.stringify([{ productId: "id1", slug: "slug-1" }, { productId: "id2", slug: "slug-2" }]));
    hydrateGuestFavourites();
  };

  it("FAV-01 · a successful merge posts the guest ids and clears the local list afterwards", async () => {
    seed();
    asCustomer();
    respond = (c) => (c.path.endsWith("/merge") ? json(200, { productIds: ["id2", "id1"], total: 2, skipped: 0, truncated: 0 }) : json(200, wishlist([product(2), product(1)])));
    await syncFavouritesAfterLogin();
    expect(calls[0]).toMatchObject({ method: "POST", path: "/me/wishlist/merge", body: { productIds: ["id1", "id2"] } });
    expect(stored()).toEqual([]);
    expect(useFavouritesStore.getState().ids).toEqual(["id2", "id1"]);
    expect(useFavouritesStore.getState().mergeFailed).toBe(false);
  });

  it("FAV-01 · a failed merge keeps the local list, still loads the account list and offers a retry", async () => {
    seed();
    asCustomer();
    let fail = true;
    respond = (c) =>
      c.path.endsWith("/merge")
        ? fail
          ? json(500, { code: "INTERNAL_ERROR", message: "x" })
          : json(200, { productIds: ["id1", "id2"], total: 2, skipped: 0, truncated: 0 })
        : json(200, wishlist([product(9)]));
    await syncFavouritesAfterLogin();
    expect(stored()).toHaveLength(2);
    expect(useFavouritesStore.getState().mergeFailed).toBe(true);
    expect(useFavouritesStore.getState().ids).toEqual(["id9"]);
    fail = false;
    await syncFavouritesAfterLogin();
    expect(stored()).toEqual([]);
    expect(useFavouritesStore.getState().mergeFailed).toBe(false);
  });

  it("FAV-01 · an empty guest list just loads the account list (no merge call)", async () => {
    asCustomer();
    respond = () => json(200, wishlist([product(3)]));
    await syncFavouritesAfterLogin();
    expect(calls.map((c) => c.path)).toEqual(["/me/wishlist"]);
  });

  it("FAV-01 · FavouritesSync merges when a customer logs in", async () => {
    seed();
    respond = (c) => (c.path.endsWith("/merge") ? json(200, { productIds: ["id1", "id2"], total: 2, skipped: 0, truncated: 0 }) : json(200, wishlist([])));
    wrap("en", <FavouritesSync />);
    await act(async () => asCustomer());
    await waitFor(() => expect(calls.some((c) => c.path === "/me/wishlist/merge")).toBe(true));
    await waitFor(() => expect(stored()).toEqual([]));
  });
});

describe.each(["en", "ar"] as const)("FAV-01 · UI (%s)", (locale) => {
  const m = messages[locale];

  it(`FAV-01 · the header heart shows the count (${locale})`, async () => {
    wrap(locale, <FavouritesLink />);
    expect(screen.queryByTestId("favourites-count")).toBeNull();
    await act(async () => {
      await toggleFavourite(product(1));
      await toggleFavourite(product(2));
    });
    expect(screen.getByTestId("favourites-count").textContent).toBe("2");
    expect(screen.getByRole("link").getAttribute("aria-label")).toBe(m.favourites.linkLabel.replace("{count}", "2"));
    expect(screen.getByRole("link").getAttribute("href")).toBe("/favourites");
  });

  it(`FAV-01 · the card heart toggles the guest list (${locale})`, async () => {
    wrap(locale, <ul><ConnectedProductCard product={product(1)} locale={locale} /></ul>);
    const heart = screen.getByTestId("favourite-toggle");
    expect(heart.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(heart);
    await waitFor(() => expect(screen.getByTestId("favourite-toggle").getAttribute("aria-pressed")).toBe("true"));
    expect(stored()).toEqual([{ productId: "id1", slug: "slug-1" }]);
  });

  it(`FAV-01 · the page shows the empty state (${locale})`, async () => {
    useAuthStore.getState().clear();
    wrap(locale, <FavouritesPage />);
    expect(await screen.findByTestId("favourites-empty")).toBeTruthy();
    expect(screen.getByText(m.favourites.emptyTitle)).toBeTruthy();
  });

  it(`FAV-01 · a customer's page lists the account favourites with removable hearts (${locale})`, async () => {
    asCustomer();
    respond = (c) => json(200, wishlist(c.method === "DELETE" ? [product(2)] : [product(1), product(2)]));
    wrap(locale, <FavouritesPage />);
    expect(await screen.findByTestId("favourites-grid")).toBeTruthy();
    expect(screen.getAllByTestId("product-card")).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId("favourite-toggle")[0]!);
    await waitFor(() => expect(screen.getAllByTestId("product-card")).toHaveLength(1));
  });

  it(`FAV-01 · the page shows the merge-failed notice with a retry (${locale})`, async () => {
    asCustomer();
    window.localStorage.setItem(GUEST_FAV_KEY, JSON.stringify([{ productId: "id1", slug: "slug-1" }]));
    hydrateGuestFavourites();
    respond = (c) => (c.path.endsWith("/merge") ? json(500, { code: "INTERNAL_ERROR", message: "x" }) : json(200, wishlist([])));
    await syncFavouritesAfterLogin();
    wrap(locale, <FavouritesPage />);
    expect(screen.getByTestId("merge-failed").textContent).toContain(m.favourites.mergeFailed);
    expect(screen.getByText(m.favourites.retry)).toBeTruthy();
  });

  it(`FAV-01 · the localized full message appears when the list is full (${locale})`, async () => {
    window.localStorage.setItem(
      GUEST_FAV_KEY,
      JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ productId: `x${i}`, slug: `s${i}` }))),
    );
    hydrateGuestFavourites();
    wrap(locale, <FavouritesSync />);
    await act(async () => toggleFavourite(product(900)));
    expect(screen.getByTestId("favourites-full").textContent).toBe(m.favourites.full);
  });
});
