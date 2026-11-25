import { useMemo } from "react";
import {
  bySortOrder,
  moveItem,
  useSections,
  type AdminSection,
  type LookHotspot,
  type LookValue,
} from "@/lib/sections";

// T-085: a "look" is a home section of type SHOP_THE_LOOK, so there is no separate endpoint - the list,
// the order, the visible toggle and delete are all `/admin/home-sections` (api-spec, backend T-110).

export const MAX_POINTS = 6;
export const LOOK_TYPE = "SHOP_THE_LOOK" as const;

export type AdminLook = AdminSection & { config: { look: LookValue } };

export const isLook = (s: AdminSection): s is AdminLook =>
  s.type === LOOK_TYPE && !!s.config?.look?.image && Array.isArray(s.config.look.hotspots);

/** A point the website will not show: its product was deleted, or is no longer published. */
export const isPointDead = (h: LookHotspot): boolean => !h.product || h.product.status !== "PUBLISHED";
export const hasDeadPoint = (look: AdminLook): boolean => look.config.look.hotspots.some(isPointDead);

/**
 * The order of looks is the order of their sections, and `PUT /admin/home-sections/reorder` insists on the
 * **whole** id list. So moving a look one place up or down swaps it with the neighbouring *look* inside the
 * full list: every other section keeps its position, and the list that goes to the API stays complete.
 * Returns the input unchanged when the move has nowhere to go.
 */
export function moveAmongLooks(
  allIds: readonly string[],
  lookIds: readonly string[],
  id: string,
  delta: 1 | -1,
): string[] {
  const at = lookIds.indexOf(id);
  if (at === -1 || lookIds[at + delta] === undefined) return [...allIds];
  return placeLooks(allIds, lookIds, moveItem(lookIds, at, at + delta));
}

/** The same thing for a drag, which may cross several looks at once. */
export const dragLooks = (
  allIds: readonly string[],
  lookIds: readonly string[],
  from: number,
  to: number,
): string[] => placeLooks(allIds, lookIds, moveItem(lookIds, from, to));

/** Put `nextLookIds` back into the look-shaped slots of the full list, leaving everything else untouched. */
function placeLooks(
  allIds: readonly string[],
  lookIds: readonly string[],
  nextLookIds: readonly string[],
): string[] {
  const isLookId = new Set(lookIds);
  let i = 0;
  return allIds.map((id) => (isLookId.has(id) ? (nextLookIds[i++] ?? id) : id));
}

/** Every section (for the reorder call) plus just the looks, both in the home page's order. */
export function useLooks() {
  const query = useSections();
  const all = useMemo(() => [...(query.data ?? [])].sort(bySortOrder), [query.data]);
  const looks = useMemo(() => all.filter(isLook), [all]);
  return { query, all, looks, allIds: all.map((s) => s.id), lookIds: looks.map((s) => s.id) };
}
