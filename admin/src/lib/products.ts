import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api/client";
import type { Locale } from "@/lib/format";
import { halalasToSar, MAX_PRICE_HALALAS, parseSar, sarHalalas } from "@/lib/money";

// api-spec.yaml /admin/products (ADM-02, I18N-02). The API keeps taking integer halalas; the admin
// types SAR with at most 2 decimals and the conversion is exact (owner 2026-11-24, closes B-031 -
// typing halalas invited 100x pricing mistakes). Stock stays a plain integer.

export type LocalizedText = { en: string; ar: string };
export type ProductType = "NEW" | "RESALE";
export type Condition = "NEW" | "LIKE_NEW" | "GOOD" | "FAIR";
export type ProductStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type StoredImage = {
  key: string;
  url: string;
  alt?: LocalizedText | null;
  width?: number | null;
  height?: number | null;
  /** Banner focal point in percent (CR-011); null or absent = centre. */
  focalX?: number | null;
  focalY?: number | null;
};
export type Dimensions = { widthCm?: number; depthCm?: number; heightCm?: number; weightKg?: number };
export type AdminProduct = {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  slug: string;
  sku?: string | null;
  type: ProductType;
  condition: Condition;
  conditionNotes?: LocalizedText | null;
  price: number;
  compareAtPrice?: number | null;
  stock: number;
  categoryId: string;
  images: StoredImage[];
  dimensions?: Dimensions | null;
  material?: string | null;
  color?: string | null;
  isFeatured: boolean;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
};
export type ProductPage = {
  items: AdminProduct[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};
export type ProductQuery = { q: string; status: "" | ProductStatus; type: "" | ProductType; page: number };

export const PAGE_SIZE = 20;
export const MAX_IMAGES = 8;
export const LOW_STOCK = 2; // screen-specs A-02: stock shown red when <= 2

const KEY = ["admin", "products"] as const;

export function useProducts(p: ProductQuery) {
  const qs = new URLSearchParams({ page: String(p.page), limit: String(PAGE_SIZE) });
  if (p.q.trim()) qs.set("q", p.q.trim().slice(0, 100));
  if (p.status) qs.set("status", p.status);
  if (p.type) qs.set("type", p.type);
  return useQuery({
    queryKey: [...KEY, "list", qs.toString()],
    queryFn: ({ signal }) => api.get<ProductPage>(`/admin/products?${qs}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, "one", id],
    enabled: !!id,
    // The editor keeps the loaded copy (its updatedAt is the concurrency token); refetch only on demand.
    staleTime: Infinity,
    gcTime: 0,
    queryFn: ({ signal }) => api.get<AdminProduct>(`/admin/products/${encodeURIComponent(id!)}`, { signal }),
  });
}

export function useSaveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ProductWrite }) =>
      id ? api.patch<AdminProduct>(`/admin/products/${encodeURIComponent(id)}`, body) : api.post<AdminProduct>("/admin/products", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, "list"] }),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/admin/products/${encodeURIComponent(id)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: [...KEY, "list"] }),
  });
}

export type ProductWrite = {
  expectedUpdatedAt?: string;
  title: LocalizedText;
  description: LocalizedText;
  slug: string;
  sku: string | null;
  type: ProductType;
  condition: Condition;
  conditionNotes: LocalizedText | null;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  categoryId: string;
  images: { key: string; alt?: LocalizedText }[];
  dimensions: Dimensions | null;
  material: string | null;
  color: string | null;
  isFeatured: boolean;
  status: ProductStatus;
};

export const RESALE_CONDITIONS: Condition[] = ["LIKE_NEW", "GOOD", "FAIR"];
const MAX_STOCK = 100_000;
const int = (max: number) => z.string().trim().regex(/^\d{1,9}$/, "products.form.intInvalid").refine((v) => Number(v) <= max, "products.form.tooBig");

/**
 * Money is typed in SAR with at most 2 decimals and converted to exact halalas (A3, closes B-031).
 * `optional` allows "" (compare-at price left empty = null).
 */
const sar = (optional: boolean) =>
  z.string().superRefine((v: string, ctx: z.RefinementCtx) => {
    if (optional && v.trim() === "") return;
    const p = parseSar(v);
    if (!p.ok) {
      ctx.addIssue({ code: "custom", message: p.reason === "negative" ? "products.form.amountNegative" : "products.form.amountInvalid" });
      return;
    }
    if (p.halalas > MAX_PRICE_HALALAS) ctx.addIssue({ code: "custom", message: "products.form.tooBig" });
  });
const optDim = z
  .string()
  .trim()
  .refine((v) => v === "" || (/^\d{1,6}(\.\d{1,2})?$/.test(v) && Number(v) > 0), "products.form.dimInvalid");

// Message values are locale keys, translated by the form. Limits per ProductInput.
export const productSchema = z
  .object({
    titleEn: z.string().trim().max(120, "products.form.tooLong"),
    titleAr: z.string().trim().max(120, "products.form.tooLong"),
    descEn: z.string().trim().max(5000, "products.form.tooLong"),
    descAr: z.string().trim().max(5000, "products.form.tooLong"),
    notesEn: z.string().trim().max(1000, "products.form.tooLong"),
    notesAr: z.string().trim().max(1000, "products.form.tooLong"),
    slug: z
      .string()
      .trim()
      .min(1, "products.form.required")
      .max(60, "products.form.tooLong")
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "products.form.slugInvalid"),
    sku: z.string().trim().max(40, "products.form.tooLong"),
    type: z.enum(["NEW", "RESALE"]),
    condition: z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR"]),
    price: sar(false),
    compareAtPrice: sar(true),
    stock: int(MAX_STOCK),
    categoryId: z.string().min(1, "products.form.required"),
    widthCm: optDim,
    depthCm: optDim,
    heightCm: optDim,
    weightKg: optDim,
    material: z.string().trim().max(60, "products.form.tooLong"),
    color: z.string().trim().max(60, "products.form.tooLong"),
    status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
    isFeatured: z.boolean(),
  })
  .superRefine((v, ctx) => {
    // I18N-02 (owner 2026-11-22): DRAFT needs >= 1 non-empty locale, PUBLISHED both, for title and description.
    const need = v.status === "PUBLISHED" ? 2 : 1;
    const gate = (en: string, ar: string, first: "titleEn" | "descEn", second: "titleAr" | "descAr") => {
      const filled = (en ? 1 : 0) + (ar ? 1 : 0);
      if (filled >= need) return;
      if (v.status === "PUBLISHED") {
        if (!en) ctx.addIssue({ code: "custom", path: [first], message: "products.form.publishNeedsBoth" });
        if (!ar) ctx.addIssue({ code: "custom", path: [second], message: "products.form.publishNeedsBoth" });
      } else {
        ctx.addIssue({ code: "custom", path: [second], message: "products.form.needOne" });
      }
    };
    gate(v.titleEn, v.titleAr, "titleEn", "titleAr");
    gate(v.descEn, v.descAr, "descEn", "descAr");
    // Compared in halalas, so "1,250.50" and "1250.5" behave the same.
    const compare = parseSar(v.compareAtPrice);
    const price = parseSar(v.price);
    if (v.compareAtPrice.trim() !== "" && compare.ok && price.ok && compare.halalas <= price.halalas) {
      ctx.addIssue({ code: "custom", path: ["compareAtPrice"], message: "products.form.compareHigher" });
    }
    // type NEW <=> condition NEW; RESALE <=> LIKE_NEW | GOOD | FAIR (data-model, T-010).
    const ok = v.type === "NEW" ? v.condition === "NEW" : RESALE_CONDITIONS.includes(v.condition);
    if (!ok) ctx.addIssue({ code: "custom", path: ["condition"], message: "products.form.conditionMismatch" });
  });
export type ProductFormValues = z.infer<typeof productSchema>;

export function toFormValues(p: AdminProduct | null): ProductFormValues {
  const d = p?.dimensions ?? {};
  const s = (n: number | undefined | null) => (n === undefined || n === null ? "" : String(n));
  return {
    titleEn: p?.title.en ?? "",
    titleAr: p?.title.ar ?? "",
    descEn: p?.description.en ?? "",
    descAr: p?.description.ar ?? "",
    notesEn: p?.conditionNotes?.en ?? "",
    notesAr: p?.conditionNotes?.ar ?? "",
    slug: p?.slug ?? "",
    sku: p?.sku ?? "",
    type: p?.type ?? "NEW",
    condition: p?.condition ?? "NEW",
    price: p ? halalasToSar(p.price) : "0",
    compareAtPrice: p?.compareAtPrice == null ? "" : halalasToSar(p.compareAtPrice),
    stock: p ? String(p.stock) : "0",
    categoryId: p?.categoryId ?? "",
    widthCm: s(d.widthCm),
    depthCm: s(d.depthCm),
    heightCm: s(d.heightCm),
    weightKg: s(d.weightKg),
    material: p?.material ?? "",
    color: p?.color ?? "",
    status: p?.status ?? "DRAFT",
    isFeatured: p?.isFeatured ?? false,
  };
}

const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

export function toWrite(v: ProductFormValues, images: ProductWrite["images"]): ProductWrite {
  const dims: Dimensions = {};
  if (v.widthCm) dims.widthCm = Number(v.widthCm);
  if (v.depthCm) dims.depthCm = Number(v.depthCm);
  if (v.heightCm) dims.heightCm = Number(v.heightCm);
  if (v.weightKg) dims.weightKg = Number(v.weightKg);
  return {
    title: { en: v.titleEn, ar: v.titleAr },
    description: { en: v.descEn, ar: v.descAr },
    slug: v.slug,
    sku: orNull(v.sku),
    type: v.type,
    condition: v.condition,
    conditionNotes: v.notesEn || v.notesAr ? { en: v.notesEn, ar: v.notesAr } : null,
    price: sarHalalas(v.price),
    compareAtPrice: v.compareAtPrice.trim() === "" ? null : sarHalalas(v.compareAtPrice),
    stock: Number(v.stock),
    categoryId: v.categoryId,
    images,
    dimensions: Object.keys(dims).length ? dims : null,
    material: orNull(v.material),
    color: orNull(v.color),
    isFeatured: v.isFeatured,
    status: v.status,
  };
}

/** Text in the active locale, falling back to Arabic then English (ADR-006). */
export function pickText(t: LocalizedText, locale: Locale): string {
  return t[locale] || t.ar || t.en;
}
