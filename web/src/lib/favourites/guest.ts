// Guest favourites (FAV-01): localStorage. Entries hold the product id and slug (the slug is only needed
// to load display data, there is no by-id product endpoint). Every access is guarded: storage can be blocked.

export const GUEST_FAV_KEY = "fx_guest_favourites";
export const MAX_FAVOURITES = 100;

export type GuestFavourite = { productId: string; slug: string };

const ID = /^[\w-]{1,64}$/;

function valid(l: unknown): l is GuestFavourite {
  if (typeof l !== "object" || l === null) return false;
  const r = l as Record<string, unknown>;
  return (
    typeof r.productId === "string" &&
    ID.test(r.productId) &&
    typeof r.slug === "string" &&
    r.slug.length > 0 &&
    r.slug.length <= 200
  );
}

export function readGuestFavourites(): GuestFavourite[] {
  try {
    const raw = window.localStorage.getItem(GUEST_FAV_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const seen = new Set<string>();
    const out: GuestFavourite[] = [];
    for (const l of data) {
      if (!valid(l) || seen.has(l.productId)) continue;
      seen.add(l.productId);
      out.push({ productId: l.productId, slug: l.slug });
      if (out.length >= MAX_FAVOURITES) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function writeGuestFavourites(list: GuestFavourite[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(GUEST_FAV_KEY);
    else window.localStorage.setItem(GUEST_FAV_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: the in-memory list still works for this visit */
  }
}
