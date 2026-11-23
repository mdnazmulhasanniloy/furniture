import { create } from "zustand";

import { apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";

import { clearGuest, MAX_GUEST_LINES, MAX_QTY, readGuest, writeGuest } from "./guest";
import type { CartConfig, GuestLine, ServerCart } from "./types";

// Cart state (CART-01, ADR-002 Zustand). Logged-in customers use the server cart; guests use the
// localStorage cart. Totals, VAT, delivery fee and stock conflicts are displayed exactly as the
// API returns them; nothing is reserved or computed here.

export type CartProductLite = Pick<HomeProduct, "id" | "slug" | "stock"> & Partial<HomeProduct>;

type CartState = {
  guest: GuestLine[];
  /** productId -> product (display data). `null` = the product no longer exists. */
  guestProducts: Record<string, HomeProduct | null>;
  cart: ServerCart | null;
  loading: boolean;
  /** Error code of the last failed operation (mapped to a message by the UI). */
  error: string | null;
  mergeFailed: boolean;
  drawerOpen: boolean;
  /** Bumped on each successful add: drives the live "Added to cart" announcement. */
  addedTick: number;
  config: CartConfig;
};

const initial: CartState = {
  guest: [],
  guestProducts: {},
  cart: null,
  loading: false,
  error: null,
  mergeFailed: false,
  drawerOpen: false,
  addedTick: 0,
  config: { freeDeliveryThreshold: null, hasCityFeeOverride: false },
};

export const useCartStore = create<CartState>(() => initial);

const set = useCartStore.setState;
const get = useCartStore.getState;

/** Test seam. */
export function resetCartStore() {
  useCartStore.setState(initial, true);
}

/** Logged-in customers use the server cart (admins get 403 there, so they stay on the guest cart). */
export function isServerCart(): boolean {
  const a = useAuthStore.getState();
  return a.status === "authenticated" && a.user?.role === "CUSTOMER";
}

function codeOf(e: unknown): string {
  return e instanceof ApiError ? e.code : "generic";
}

// Writes run one after another so rapid clicks cannot interleave.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Backend T-012: on 409 CART_CONFLICT retry the write once. */
async function withConflictRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.code === "CART_CONFLICT") return fn();
    throw e;
  }
}

export function setCartConfig(config: CartConfig) {
  const c = get().config;
  if (
    c.freeDeliveryThreshold !== config.freeDeliveryThreshold ||
    c.hasCityFeeOverride !== config.hasCityFeeOverride
  ) {
    set({ config });
  }
}

export function openDrawer() {
  set({ drawerOpen: true });
}
export function closeDrawer() {
  set({ drawerOpen: false });
}

// ---------------- guest cart ----------------

export function hydrateGuest() {
  set({ guest: readGuest() });
}

function commitGuest(lines: GuestLine[]) {
  writeGuest(lines);
  set({ guest: lines });
}

/** Load display data (live price/stock) for guest lines; only ids/qty are stored locally. */
export async function resolveGuestProducts(): Promise<void> {
  const { guest, guestProducts } = get();
  const missing = guest.filter((l) => !(l.productId in guestProducts));
  if (missing.length === 0) return;
  await Promise.all(
    missing.map(async (l) => {
      try {
        const data = await apiRequest<{ product?: HomeProduct }>(
          `/products/${encodeURIComponent(l.slug)}`,
          { skipAuth: true },
        );
        const product = data.product ?? null;
        set((s) => ({ guestProducts: { ...s.guestProducts, [l.productId]: product } }));
        if (product && product.stock > 0 && l.qty > product.stock) {
          // Quantity is capped at stock (CART-01).
          commitGuest(
            get().guest.map((g) => (g.productId === l.productId ? { ...g, qty: product.stock } : g)),
          );
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          set((s) => ({ guestProducts: { ...s.guestProducts, [l.productId]: null } }));
        } else {
          set({ error: codeOf(e) });
        }
      }
    }),
  );
}

function guestSet(product: CartProductLite, qty: number) {
  const lines = get().guest;
  const next = Math.min(qty, product.stock, MAX_QTY);
  const others = lines.filter((l) => l.productId !== product.id);
  if (next <= 0) {
    commitGuest(others);
    return;
  }
  const exists = others.length !== lines.length;
  if (!exists && lines.length >= MAX_GUEST_LINES) {
    throw new ApiError({ status: 409, code: "CART_LIMIT_REACHED" });
  }
  const line: GuestLine = { productId: product.id, slug: product.slug, qty: next };
  commitGuest(exists ? lines.map((l) => (l.productId === product.id ? line : l)) : [...lines, line]);
  if (product.title) {
    set((s) => ({ guestProducts: { ...s.guestProducts, [product.id]: product as HomeProduct } }));
  }
}

// ---------------- server cart ----------------

/** `addressId` (checkout): fee uses that address's city and the response carries `address.isDeliverable`. */
export async function loadCart(addressId?: string): Promise<void> {
  set({ loading: true, error: null });
  try {
    const cart = await apiRequest<ServerCart>(
      addressId ? `/cart?addressId=${encodeURIComponent(addressId)}` : "/cart",
    );
    set({ cart, loading: false });
  } catch (e) {
    set({ loading: false, error: codeOf(e) });
  }
}

function serverQty(productId: string): number {
  return get().cart?.items.find((i) => i.product?.id === productId)?.qty ?? 0;
}

async function serverSet(productId: string, qty: number) {
  const cart = await withConflictRetry(() =>
    apiRequest<ServerCart>("/cart/items", { method: "PUT", body: { productId, qty } }),
  );
  set({ cart });
}

// ---------------- public actions ----------------

/** Add `qty` of a product (capped at stock). Resolves true when the cart changed. */
export function addToCart(product: CartProductLite, qty: number): Promise<boolean> {
  return enqueue(async () => {
    set({ error: null });
    try {
      if (isServerCart()) {
        await serverSet(product.id, Math.min(serverQty(product.id) + qty, product.stock, MAX_QTY));
      } else {
        const existing = get().guest.find((l) => l.productId === product.id)?.qty ?? 0;
        guestSet(product, existing + qty);
      }
      set((s) => ({ addedTick: s.addedTick + 1, drawerOpen: true }));
      return true;
    } catch (e) {
      set({ error: codeOf(e), drawerOpen: true });
      return false;
    }
  });
}

/** Set an absolute quantity (0 removes). `stock` caps the quantity. */
export function setLineQty(productId: string, qty: number, stock: number): Promise<void> {
  return enqueue(async () => {
    set({ error: null });
    try {
      if (isServerCart()) {
        await serverSet(productId, Math.min(Math.max(qty, 0), stock));
      } else {
        const line = get().guest.find((l) => l.productId === productId);
        if (line) guestSet({ id: productId, slug: line.slug, stock }, Math.max(qty, 0));
      }
    } catch (e) {
      set({ error: codeOf(e) });
      if (isServerCart()) await loadCart();
    }
  });
}

let merging: Promise<void> | null = null;

/**
 * After login: send the guest cart to `POST /cart/merge` and clear localStorage ONLY after a
 * successful response (backend T-012; merge is idempotent so a retry is safe). Otherwise just
 * load the server cart.
 */
export function syncAfterLogin(): Promise<void> {
  if (merging) return merging;
  merging = (async () => {
    const guest = readGuest();
    set({ guest, mergeFailed: false, error: null });
    if (guest.length === 0) {
      await loadCart();
      return;
    }
    set({ loading: true });
    try {
      const items = guest.slice(0, 100).map(({ productId, qty }) => ({ productId, qty }));
      const cart = await withConflictRetry(() =>
        apiRequest<ServerCart>("/cart/merge", { method: "POST", body: { items } }),
      );
      clearGuest();
      set({ cart, guest: [], guestProducts: {}, loading: false });
    } catch (e) {
      set({ loading: false });
      await loadCart(); // show what the account already has; local items stay for a retry
      set({ mergeFailed: true, error: codeOf(e) });
    }
  })().finally(() => {
    merging = null;
  });
  return merging;
}

/** Logout / anonymous: drop the server cart from memory; the guest cart comes from storage. */
export function resetToGuest() {
  set({ cart: null, error: null, mergeFailed: false, guest: readGuest() });
}

/** Item count shown in the header badge. */
export function cartCount(s: Pick<CartState, "cart" | "guest">, server: boolean): number {
  if (server) return s.cart?.items.reduce((n, i) => n + (i.product ? i.qty : 0), 0) ?? 0;
  return s.guest.reduce((n, l) => n + l.qty, 0);
}
