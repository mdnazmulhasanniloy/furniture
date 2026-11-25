import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api/client";
import type { LocalizedText, ProductStatus, StoredImage } from "@/lib/products";

// api-spec.yaml /admin/home-sections (ADM-07). PATCH always carries `expectedUpdatedAt` (409 STALE_UPDATE,
// backend T-011); `PUT /admin/home-sections/reorder` takes exactly the full list of existing ids.

/** Types an admin can create here. SHOP_THE_LOOK is missing on purpose: this form cannot build a photo
 *  with its points, so a look is created in its own editor instead (T-085, /sections/looks). */
export const SECTION_TYPES = [
  "FEATURED_PRODUCTS",
  "NEW_ARRIVALS",
  "RESALE_PICKS",
  "CATEGORY_GRID",
  "PROMO_BANNER",
  "TESTIMONIALS",
] as const;

/**
 * Every type the API can return (api-spec `SectionType`), so the list always has a label for what it
 * shows - a SHOP_THE_LOOK section used to print the raw key (QA B4, 2026-11-24).
 */
export const ALL_SECTION_TYPES = [...SECTION_TYPES, "SHOP_THE_LOOK"] as const;
export type SectionType = (typeof ALL_SECTION_TYPES)[number];
/** The subset an admin may create. */
export type CreatableSectionType = (typeof SECTION_TYPES)[number];

/**
 * SHOP_THE_LOOK config (api-spec `HomeSectionConfig.look`, backend T-110). `width`/`height` are the photo's
 * own pixel size and are required: the storefront renders the photo uncropped at that ratio, which is what
 * keeps a point on the same spot of the photo at every screen width. `product` is filled in by the admin API
 * only (never sent back) so the list and the editor can show what a point links to, and `null` when that
 * product has been deleted.
 */
export type LookImage = {
  key: string;
  url: string;
  alt: LocalizedText;
  width: number;
  height: number;
};
export type LookHotspotProduct = {
  id: string;
  title: LocalizedText;
  slug: string;
  price: number;
  status: ProductStatus;
  image: StoredImage | null;
};
export type LookHotspot = {
  x: number;
  y: number;
  productId: string;
  product?: LookHotspotProduct | null;
};
export type LookValue = { image: LookImage; hotspots: LookHotspot[] };

export type SectionConfig = {
  productIds?: string[];
  categoryIds?: string[];
  limit?: number;
  bannerId?: string;
  testimonials?: { name: string; quote: LocalizedText }[];
  look?: LookValue;
};

export type AdminSection = {
  id: string;
  type: SectionType;
  title: LocalizedText;
  subtitle: LocalizedText | null;
  config: SectionConfig | null;
  sortOrder: number;
  isVisible: boolean;
  updatedAt: string;
};

export type SectionPatch = {
  title?: LocalizedText;
  subtitle?: LocalizedText | null;
  config?: SectionWrite["config"];
  isVisible?: boolean;
  expectedUpdatedAt: string;
};

/** What a write sends: the photo is the R2 key plus its alt text and size, never a url (the server builds it). */
export type LookWrite = {
  image: { key: string; alt: LocalizedText; width: number; height: number };
  hotspots: { x: number; y: number; productId: string }[];
};
export type SectionWrite = {
  type: SectionType;
  title: LocalizedText;
  subtitle?: LocalizedText | null;
  config?: Omit<SectionConfig, "look"> & { look?: LookWrite };
  sortOrder?: number;
  isVisible?: boolean;
};

/** Section types whose config.limit (resolved product count, default 8) applies. */
export const LIMIT_TYPES: readonly SectionType[] = ["FEATURED_PRODUCTS", "NEW_ARRIVALS", "RESALE_PICKS"];
export const DEFAULT_LIMIT = 8;

const KEY = ["admin", "home-sections"] as const;

export const bySortOrder = (a: AdminSection, b: AdminSection) => a.sortOrder - b.sortOrder;

/** Move the item at `from` to `to` (pure). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export function useSections() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api.get<AdminSection[]>("/admin/home-sections", { signal }),
  });
}

export function useSaveSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SectionPatch }) =>
      api.patch<AdminSection>(`/admin/home-sections/${encodeURIComponent(id)}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Create a section (used by the look editor, T-085; the generic form cannot build a look config). */
export function useCreateSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SectionWrite) => api.post<AdminSection>("/admin/home-sections", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/admin/home-sections/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * Persist a new order. The cache is updated first (optimistic); on failure it is rolled back and the
 * list reloaded. `ids` is always the complete id list (API rejects anything else with 422).
 */
export function useReorderSections() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.put<void>("/admin/home-sections/reorder", { ids }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<AdminSection[]>(KEY);
      if (prev) {
        const byId = new Map(prev.map((s) => [s.id, s]));
        qc.setQueryData<AdminSection[]>(
          KEY,
          ids.flatMap((id, i) => {
            const s = byId.get(id);
            return s ? [{ ...s, sortOrder: i }] : [];
          }),
        );
      }
      return { prev };
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    // The server bumps updatedAt on every section; reload so later PATCHes carry a current value.
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

// SectionInput limits: title en + ar required 1-120; subtitle <= 200 per locale (both-or-none);
// config.limit integer 1-24 for the product sections.
export const sectionSchema = z
  .object({
    titleEn: z.string().trim().min(1, "sections.form.required").max(120, "sections.form.tooLong"),
    titleAr: z.string().trim().min(1, "sections.form.required").max(120, "sections.form.tooLong"),
    subtitleEn: z.string().trim().max(200, "sections.form.tooLong"),
    subtitleAr: z.string().trim().max(200, "sections.form.tooLong"),
    limit: z.string().trim(),
    isVisible: z.boolean(),
    hasLimit: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if ((v.subtitleEn === "") !== (v.subtitleAr === ""))
      ctx.addIssue({
        code: "custom",
        path: [v.subtitleEn === "" ? "subtitleEn" : "subtitleAr"],
        message: "sections.form.bothLocales",
      });
    if (v.hasLimit) {
      const n = Number(v.limit);
      if (!/^\d{1,2}$/.test(v.limit) || n < 1 || n > 24)
        ctx.addIssue({ code: "custom", path: ["limit"], message: "sections.form.limitInvalid" });
    }
  });
export type SectionFormValues = z.infer<typeof sectionSchema>;
