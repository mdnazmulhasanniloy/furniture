import type { GuestLine } from "./types";

// Guest cart (CART-01): localStorage, product id + slug + qty only. Prices, titles and stock are
// always re-read from the API for display. Every access is guarded: storage can be blocked.

export const GUEST_KEY = "fx_guest_cart";
export const MAX_GUEST_LINES = 50; // same as the server cart limit (CART_LIMIT_REACHED)
export const MAX_QTY = 100_000;

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function valid(l: unknown): l is GuestLine {
  if (typeof l !== "object" || l === null) return false;
  const r = l as Record<string, unknown>;
  return (
    typeof r.productId === "string" &&
    r.productId.length > 0 &&
    r.productId.length <= 64 &&
    (OBJECT_ID.test(r.productId) || /^[\w-]+$/.test(r.productId)) &&
    typeof r.slug === "string" &&
    r.slug.length > 0 &&
    r.slug.length <= 200 &&
    Number.isInteger(r.qty) &&
    (r.qty as number) >= 1 &&
    (r.qty as number) <= MAX_QTY
  );
}

export function readGuest(): GuestLine[] {
  try {
    const raw = window.localStorage.getItem(GUEST_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    const out: GuestLine[] = [];
    for (const l of data) {
      if (!valid(l) || seen.has(l.productId)) continue;
      seen.add(l.productId);
      out.push({ productId: l.productId, slug: l.slug, qty: l.qty });
      if (out.length >= MAX_GUEST_LINES) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function writeGuest(lines: GuestLine[]): void {
  try {
    if (lines.length === 0) window.localStorage.removeItem(GUEST_KEY);
    else window.localStorage.setItem(GUEST_KEY, JSON.stringify(lines));
  } catch {
    /* storage unavailable: the in-memory cart still works for this visit */
  }
}

export function clearGuest(): void {
  writeGuest([]);
}
