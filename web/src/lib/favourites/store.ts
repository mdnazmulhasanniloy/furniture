import { create } from "zustand";

import { apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";

import {
  MAX_FAVOURITES,
  readGuestFavourites,
  writeGuestFavourites,
  type GuestFavourite,
} from "./guest";

// Favourites state (FAV-01). Customers use the account list (`/me/wishlist`, per-item idempotent
// writes); guests and admins use the localStorage list. After login the guest list is merged and
// cleared ONLY after the merge succeeded.

type Wishlist = { productIds: string[]; items: HomeProduct[]; total: number };

type FavState = {
  guest: GuestFavourite[];
  /** Account list, newest first (customers). */
  ids: string[];
  items: HomeProduct[];
  loaded: boolean;
  loading: boolean;
  /** Error code of the last failed operation (mapped to a message by the UI). */
  error: string | null;
  mergeFailed: boolean;
  /** True after an add was refused because the list holds 100 products. */
  full: boolean;
};

const initial: FavState = {
  guest: [],
  ids: [],
  items: [],
  loaded: false,
  loading: false,
  error: null,
  mergeFailed: false,
  full: false,
};

export const useFavouritesStore = create<FavState>(() => initial);
const set = useFavouritesStore.setState;
const get = useFavouritesStore.getState;

/** Test seam. */
export function resetFavouritesStore() {
  useFavouritesStore.setState(initial, true);
}

/** Customers use the account list; admins (403 on /me/wishlist) and guests use the local list. */
export function isServerFavourites(): boolean {
  const a = useAuthStore.getState();
  return a.status === "authenticated" && a.user?.role === "CUSTOMER";
}

const codeOf = (e: unknown) => (e instanceof ApiError ? e.code : "INTERNAL_ERROR");

export function dismissFull() {
  set({ full: false });
}

export function hydrateGuestFavourites() {
  set({ guest: readGuestFavourites() });
}

function commitGuest(list: GuestFavourite[]) {
  writeGuestFavourites(list);
  set({ guest: list });
}

/** Ids shown as "favourite" (hearts) and counted in the header. */
export function favouriteIds(s: Pick<FavState, "guest" | "ids">, server: boolean): string[] {
  return server ? s.ids : s.guest.map((g) => g.productId);
}

let loadSeq = 0;
/** GET /me/wishlist. A stale response (a newer load started meanwhile) is ignored. */
export async function loadFavourites(): Promise<void> {
  const seq = ++loadSeq;
  set({ loading: true, error: null });
  try {
    const w = await apiRequest<Wishlist>("/me/wishlist");
    if (seq !== loadSeq) return;
    set({ ids: w.productIds, items: w.items, loaded: true, loading: false });
  } catch (e) {
    if (seq !== loadSeq) return;
    set({ loading: false, error: codeOf(e) });
  }
}

/** Toggle a heart. Customers: per-item PUT / DELETE with an optimistic update (rolled back on failure). */
export async function toggleFavourite(product: Pick<HomeProduct, "id" | "slug">): Promise<void> {
  set({ error: null, full: false });
  if (!isServerFavourites()) {
    const list = get().guest;
    if (list.some((g) => g.productId === product.id)) {
      commitGuest(list.filter((g) => g.productId !== product.id));
    } else if (list.length >= MAX_FAVOURITES) {
      set({ full: true });
    } else {
      commitGuest([...list, { productId: product.id, slug: product.slug }]);
    }
    return;
  }
  const before = { ids: get().ids, items: get().items };
  const has = before.ids.includes(product.id);
  if (!has && before.ids.length >= MAX_FAVOURITES) {
    set({ full: true });
    return;
  }
  set({
    ids: has ? before.ids.filter((i) => i !== product.id) : [product.id, ...before.ids],
    items: has ? before.items.filter((p) => p.id !== product.id) : before.items,
  });
  try {
    const w = await apiRequest<Wishlist>(`/me/wishlist/${encodeURIComponent(product.id)}`, {
      method: has ? "DELETE" : "PUT",
    });
    set({ ids: w.productIds, items: w.items, loaded: true, full: false });
  } catch (e) {
    set({ ids: before.ids, items: before.items });
    if (e instanceof ApiError && e.code === "WISHLIST_LIMIT_REACHED") set({ full: true });
    else set({ error: codeOf(e) });
  }
}

let merging: Promise<void> | null = null;

/**
 * After login: send the guest list to `POST /me/wishlist/merge` and clear localStorage ONLY after a
 * successful response (the merge is idempotent, so a retry is safe). On failure the local list stays,
 * the account list is still loaded and `mergeFailed` offers a retry.
 */
export function syncFavouritesAfterLogin(): Promise<void> {
  if (merging) return merging;
  merging = (async () => {
    const guest = readGuestFavourites();
    set({ guest, mergeFailed: false, error: null });
    if (guest.length === 0) {
      await loadFavourites();
      return;
    }
    set({ loading: true });
    try {
      await apiRequest("/me/wishlist/merge", {
        method: "POST",
        body: { productIds: guest.map((g) => g.productId).slice(0, MAX_FAVOURITES) },
      });
      writeGuestFavourites([]);
      set({ guest: [] });
      await loadFavourites();
    } catch (e) {
      set({ loading: false });
      await loadFavourites();
      set({ mergeFailed: true, error: codeOf(e) });
    }
  })().finally(() => {
    merging = null;
  });
  return merging;
}

/** Logout / anonymous: drop the account list from memory; the guest list comes from storage. */
export function resetFavouritesToGuest() {
  loadSeq++;
  set({
    ids: [],
    items: [],
    loaded: false,
    error: null,
    mergeFailed: false,
    full: false,
    guest: readGuestFavourites(),
  });
}

/**
 * Guest favourites shown on the page: product data loaded by slug (no by-id endpoint).
 *
 * QA B1: a product that answers 404 is dropped from the local list as well, so the header badge can
 * never count a product that no longer exists. Any other failure leaves the entry alone - a transient
 * error must not throw away what the visitor saved.
 */
export async function resolveGuestFavourites(): Promise<HomeProduct[]> {
  const gone: string[] = [];
  const out = await Promise.all(
    get().guest.map(async (g) => {
      try {
        const data = await apiRequest<{ product?: HomeProduct }>(
          `/products/${encodeURIComponent(g.slug)}`,
          { skipAuth: true },
        );
        if (!data.product) gone.push(g.productId);
        return data.product ?? null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) gone.push(g.productId);
        return null;
      }
    }),
  );
  if (gone.length > 0) commitGuest(get().guest.filter((g) => !gone.includes(g.productId)));
  return out.filter((p): p is HomeProduct => !!p);
}
