import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api/client";

// api-spec.yaml /admin/categories (ADM-03). Flat list incl. inactive, with productCount.
export type CategoryName = { en: string; ar: string };
export type CategoryImage = { key: string; url: string; alt?: unknown; width?: number | null; height?: number | null };
export type AdminCategory = {
  id: string;
  name: CategoryName;
  slug: string;
  image?: CategoryImage | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
};

export type CategoryWrite = {
  name?: CategoryName;
  slug?: string;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  /** `{key}` from the presign uploader (ADR-010), or null to remove. */
  image?: { key: string; alt?: { en: string; ar: string } } | null;
};

/**
 * QA B6 (2026-11-24): the API returns categories by `sortOrder`, so a child whose sortOrder is lower
 * than its parent's was listed above it. This keeps the API's order among the parents and puts each
 * parent's children straight after it - the shape the list and the product dropdown both show. The
 * data model is one level deep (a child never has children of its own); a child whose parent is not
 * in the list (deleted, or filtered out) is treated as a top-level entry, so nothing disappears.
 */
export function sortAsTree(list: AdminCategory[]): AdminCategory[] {
  const ids = new Set(list.map((c) => c.id));
  const children = new Map<string, AdminCategory[]>();
  const roots: AdminCategory[] = [];
  for (const c of list) {
    if (c.parentId && ids.has(c.parentId) && c.parentId !== c.id) {
      children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
    } else {
      roots.push(c);
    }
  }
  return roots.flatMap((parent) => [parent, ...(children.get(parent.id) ?? [])]);
}

const KEY = ["admin", "categories"] as const;

export function useCategories() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api.get<AdminCategory[]>("/admin/categories", { signal }),
  });
}

export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CategoryWrite }) =>
      id
        ? api.patch<AdminCategory>(`/admin/categories/${encodeURIComponent(id)}`, body)
        : api.post<AdminCategory>("/admin/categories", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/admin/categories/${encodeURIComponent(id)}`),
    // Refresh even on failure: a 409 means the list (productCount, children) was stale.
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

// CategoryInput limits: name en + ar required, trimmed, 1-60; slug pattern, max 60; sortOrder integer >= 0.
// Message values are locale keys, translated by the form.
export const categorySchema = z.object({
  nameEn: z.string().trim().min(1, "categories.form.required").max(60, "categories.form.tooLong"),
  nameAr: z.string().trim().min(1, "categories.form.required").max(60, "categories.form.tooLong"),
  slug: z
    .string()
    .trim()
    .min(1, "categories.form.required")
    .max(60, "categories.form.tooLong")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "categories.form.slugInvalid"),
  parentId: z.string(),
  sortOrder: z
    .string()
    .trim()
    .regex(/^\d{1,9}$/, "categories.form.sortInvalid"),
  isActive: z.boolean(),
});
export type CategoryFormValues = z.infer<typeof categorySchema>;

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
