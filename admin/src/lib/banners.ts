import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api/client";
import type { LocalizedText, StoredImage } from "@/lib/products";

// api-spec.yaml /admin/banners (ADM-06). Banner images use the R2 uploader (ADR-010); requests carry
// `{key, alt}` only (B-030). PATCH always carries `expectedUpdatedAt` (409 STALE_UPDATE, T-011).

export type AdminBanner = {
  id: string;
  title: LocalizedText;
  subtitle?: LocalizedText | null;
  ctaLabel?: LocalizedText | null;
  ctaHref?: string | null;
  imageDesktop: StoredImage;
  imageMobile?: StoredImage | null;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
};

export type BannerImageWrite = { key: string; alt: LocalizedText; focalX?: number; focalY?: number };
export type BannerWrite = {
  title?: LocalizedText;
  subtitle?: LocalizedText | null;
  ctaLabel?: LocalizedText | null;
  ctaHref?: string | null;
  imageDesktop?: BannerImageWrite;
  imageMobile?: BannerImageWrite | null;
  startsAt?: string | null;
  endsAt?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  expectedUpdatedAt?: string;
};

const KEY = ["admin", "banners"] as const;

export function useBanners() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api.get<AdminBanner[]>("/admin/banners", { signal }),
  });
}

export function useSaveBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: BannerWrite }) =>
      id
        ? api.patch<AdminBanner>(`/admin/banners/${encodeURIComponent(id)}`, body)
        : api.post<AdminBanner>("/admin/banners", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** PUT /admin/banners/order (CR-011): all-or-nothing; the list position becomes the hero slide order. */
export function useReorderBanners() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.put<void>("/admin/banners/order", { ids }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/admin/banners/${encodeURIComponent(id)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/**
 * CTA link rule (api-spec SafeHref, owner 2026-11-22, backend T-011): a same-site path ("/" followed by
 * anything but "/" or "\") or an absolute https:// URL, max 500. Everything else (//host, /\host,
 * javascript:, data:, http:) is refused. The API repeats the check and stays the authority.
 */
export function isSafeHref(raw: string): boolean {
  const v = raw;
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

// The schedule inputs are Asia/Riyadh wall-clock times (UTC+3, no daylight saving).
const RIYADH = "+03:00";

/** `YYYY-MM-DDTHH:mm` (Riyadh) -> ISO instant, or null when empty/invalid. */
export function riyadhToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00${RIYADH}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO instant -> `YYYY-MM-DDTHH:mm` in Riyadh, or "" when unset. */
export function isoToRiyadh(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Riyadh",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export type BannerState = "active" | "scheduled" | "expired" | "inactive";
export function bannerState(b: Pick<AdminBanner, "isActive" | "startsAt" | "endsAt">, now = Date.now()): BannerState {
  if (!b.isActive) return "inactive";
  if (b.startsAt && new Date(b.startsAt).getTime() > now) return "scheduled";
  if (b.endsAt && new Date(b.endsAt).getTime() <= now) return "expired";
  return "active";
}

// BannerInput limits: title en + ar required 1-120; subtitle <= 200 and ctaLabel <= 40 per locale
// (a localized text needs both locales, so each is both-or-none); startsAt < endsAt. The order is set by dragging (CR-011).
// Message values are locale keys, translated by the form.
export const bannerSchema = z
  .object({
    titleEn: z.string().trim().min(1, "banners.form.required").max(120, "banners.form.tooLong"),
    titleAr: z.string().trim().min(1, "banners.form.required").max(120, "banners.form.tooLong"),
    subtitleEn: z.string().trim().max(200, "banners.form.tooLong"),
    subtitleAr: z.string().trim().max(200, "banners.form.tooLong"),
    ctaLabelEn: z.string().trim().max(40, "banners.form.tooLong"),
    ctaLabelAr: z.string().trim().max(40, "banners.form.tooLong"),
    ctaHref: z
      .string()
      .trim()
      .refine((v) => v === "" || isSafeHref(v), "banners.form.hrefInvalid"),
    startsAt: z.string(),
    endsAt: z.string(),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const both = (a: string, b: string, p: [string, string]) => {
      if ((a === "") !== (b === "")) ctx.addIssue({ code: "custom", path: [a === "" ? p[0] : p[1]], message: "banners.form.bothLocales" });
    };
    both(v.subtitleEn, v.subtitleAr, ["subtitleEn", "subtitleAr"]);
    both(v.ctaLabelEn, v.ctaLabelAr, ["ctaLabelEn", "ctaLabelAr"]);
    const s = riyadhToIso(v.startsAt);
    const e = riyadhToIso(v.endsAt);
    if (v.startsAt && !s) ctx.addIssue({ code: "custom", path: ["startsAt"], message: "banners.form.dateInvalid" });
    if (v.endsAt && !e) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "banners.form.dateInvalid" });
    if (s && e && new Date(s).getTime() >= new Date(e).getTime())
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "banners.form.endBeforeStart" });
  });
export type BannerFormValues = z.infer<typeof bannerSchema>;

/** A focal point from a stored image (null when unset). */
export function focalOf(i: { focalX?: number | null; focalY?: number | null } | null | undefined): { x: number; y: number } | null {
  return i && typeof i.focalX === "number" && typeof i.focalY === "number" ? { x: i.focalX, y: i.focalY } : null;
}
