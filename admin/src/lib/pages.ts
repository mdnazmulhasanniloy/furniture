import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api/client";
import type { LocalizedText } from "@/lib/products";

// api-spec.yaml /admin/pages (ADM-08). Content is HTML limited to the ADR-013 allowlist; the backend
// sanitiser stays the authority. PATCH always carries `expectedUpdatedAt` (409 STALE_UPDATE, T-011).

export type AdminPage = {
  id: string;
  slug: string;
  title: LocalizedText;
  content: LocalizedText;
  metaTitle?: LocalizedText | null;
  metaDescription?: LocalizedText | null;
  isPublished: boolean;
  updatedAt: string;
};

export type PageWrite = {
  slug?: string;
  title?: LocalizedText;
  content?: LocalizedText;
  isPublished?: boolean;
  expectedUpdatedAt?: string;
};

const KEY = ["admin", "pages"] as const;

export function usePages() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api.get<AdminPage[]>("/admin/pages", { signal }),
  });
}

export function useSavePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: PageWrite }) =>
      id
        ? api.patch<AdminPage>(`/admin/pages/${encodeURIComponent(id)}`, body)
        : api.post<AdminPage>("/admin/pages", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeletePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/admin/pages/${encodeURIComponent(id)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** ADR-013 link rule: `https:` or a same-site path ("/" not followed by "/" or "\"); max 500. */
export function isSafePageHref(v: string): boolean {
  if (v.length === 0 || v.length > 500) return false;
  if (v.startsWith("/")) return v.length === 1 || (v[1] !== "/" && v[1] !== "\\");
  if (!v.startsWith("https://")) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** True for blank content or Tiptap's empty document (`<p></p>`). */
export const isEmptyHtml = (html: string) => html.replace(/<p>\s*<\/p>/g, "").trim() === "";

// PageInput limits: slug pattern max 60; title <= 120, content <= 50000 per locale. Publish gate (I18N-02):
// published needs title and content in both locales; a draft needs at least one non-empty locale.
export const pageSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1, "pages.form.required")
      .max(60, "pages.form.tooLong")
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "pages.form.slugInvalid"),
    titleEn: z.string().trim().max(120, "pages.form.tooLong"),
    titleAr: z.string().trim().max(120, "pages.form.tooLong"),
    contentEn: z.string().max(50000, "pages.form.contentTooLong"),
    contentAr: z.string().max(50000, "pages.form.contentTooLong"),
    isPublished: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const has = (l: "En" | "Ar") => v[`title${l}`] !== "" || !isEmptyHtml(v[`content${l}`]);
    if (v.isPublished) {
      for (const l of ["En", "Ar"] as const) {
        if (v[`title${l}`] === "") ctx.addIssue({ code: "custom", path: [`title${l}`], message: "pages.form.publishNeedsBoth" });
        if (isEmptyHtml(v[`content${l}`]))
          ctx.addIssue({ code: "custom", path: [`content${l}`], message: "pages.form.publishNeedsBoth" });
      }
    } else if (!has("En") && !has("Ar")) {
      ctx.addIssue({ code: "custom", path: ["titleEn"], message: "pages.form.atLeastOne" });
    }
  });
export type PageFormValues = z.infer<typeof pageSchema>;
