import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api/client";
import type { LocalizedText, StoredImage } from "@/lib/products";

// api-spec.yaml /admin/settings (ADM-09). PUT is a FULL REPLACE with `expectedUpdatedAt` (409
// STALE_UPDATE, owner 2026-11-22). Fields owned by other tasks (delivery fee/threshold/cities: T-073,
// VAT: T-074) and the fields whose rules are still blocked (contact phone B-033, social links B-034)
// are sent back exactly as received and are not editable here.

export type SiteSettings = {
  storeName: LocalizedText;
  logo?: StoredImage | null;
  contactEmail: string;
  contactPhone: string;
  address?: LocalizedText | null;
  socials?: Record<string, string | null> | null;
  deliveryFee: number;
  freeDeliveryThreshold?: number | null;
  vat: unknown;
  currency: string;
  deliveryCities: unknown[];
  defaultLocale: "ar" | "en";
  seo?: { title?: LocalizedText; description?: LocalizedText } | null;
  updatedAt: string;
};

export type SettingsEdit = {
  storeName: LocalizedText;
  logo: { key: string; alt?: LocalizedText } | null;
  contactEmail: string;
  address: LocalizedText | null;
  defaultLocale: "ar" | "en";
  seo: { title?: LocalizedText; description?: LocalizedText } | null;
};

const KEY = ["admin", "settings"] as const;

export function useSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api.get<SiteSettings>("/admin/settings", { signal }),
  });
}

/**
 * Full-replace body: the edited General/SEO fields plus everything else exactly as loaded.
 * `currency` and `updatedAt` are never sent (currency is fixed to SAR and rejected by the API).
 */
export function buildSettingsBody(base: SiteSettings, edit: SettingsEdit): Record<string, unknown> {
  const body: Record<string, unknown> = {
    expectedUpdatedAt: base.updatedAt,
    storeName: edit.storeName,
    logo: edit.logo,
    contactEmail: edit.contactEmail,
    contactPhone: base.contactPhone,
    address: edit.address,
    deliveryFee: base.deliveryFee,
    vat: base.vat,
    deliveryCities: base.deliveryCities,
    defaultLocale: edit.defaultLocale,
  };
  if (base.socials) body.socials = base.socials;
  if (base.freeDeliveryThreshold !== undefined) body.freeDeliveryThreshold = base.freeDeliveryThreshold;
  if (edit.seo) body.seo = edit.seo;
  return body;
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put<SiteSettings>("/admin/settings", body),
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}

// SiteSettingInput limits: storeName <= 120, address <= 300 per locale, contactEmail <= 120,
// SEO title <= 120 / description <= 300 per locale. A localized text needs both locales, so the
// optional ones (address, SEO title, SEO description) are both-or-none.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const settingsSchema = z
  .object({
    storeNameEn: z.string().trim().min(1, "settings.form.required").max(120, "settings.form.tooLong"),
    storeNameAr: z.string().trim().min(1, "settings.form.required").max(120, "settings.form.tooLong"),
    addressEn: z.string().trim().max(300, "settings.form.tooLong"),
    addressAr: z.string().trim().max(300, "settings.form.tooLong"),
    contactEmail: z
      .string()
      .trim()
      .min(1, "settings.form.required")
      .max(120, "settings.form.tooLong")
      .regex(EMAIL, "settings.form.emailInvalid"),
    defaultLocale: z.enum(["ar", "en"]),
    seoTitleEn: z.string().trim().max(120, "settings.form.tooLong"),
    seoTitleAr: z.string().trim().max(120, "settings.form.tooLong"),
    seoDescEn: z.string().trim().max(300, "settings.form.tooLong"),
    seoDescAr: z.string().trim().max(300, "settings.form.tooLong"),
  })
  .superRefine((v, ctx) => {
    const both = (a: keyof typeof v, b: keyof typeof v) => {
      if ((v[a] === "") !== (v[b] === ""))
        ctx.addIssue({ code: "custom", path: [v[a] === "" ? a : b], message: "settings.form.bothLocales" });
    };
    both("addressEn", "addressAr");
    both("seoTitleEn", "seoTitleAr");
    both("seoDescEn", "seoDescAr");
  });
export type SettingsFormValues = z.infer<typeof settingsSchema>;

export function settingsDefaults(s: SiteSettings): SettingsFormValues {
  return {
    storeNameEn: s.storeName.en,
    storeNameAr: s.storeName.ar,
    addressEn: s.address?.en ?? "",
    addressAr: s.address?.ar ?? "",
    contactEmail: s.contactEmail,
    defaultLocale: s.defaultLocale === "en" ? "en" : "ar",
    seoTitleEn: s.seo?.title?.en ?? "",
    seoTitleAr: s.seo?.title?.ar ?? "",
    seoDescEn: s.seo?.description?.en ?? "",
    seoDescAr: s.seo?.description?.ar ?? "",
  };
}

export function formToEdit(v: SettingsFormValues, logo: SettingsEdit["logo"]): SettingsEdit {
  const pair = (en: string, ar: string) => (en && ar ? { en, ar } : null);
  const title = pair(v.seoTitleEn, v.seoTitleAr);
  const description = pair(v.seoDescEn, v.seoDescAr);
  return {
    storeName: { en: v.storeNameEn, ar: v.storeNameAr },
    logo,
    contactEmail: v.contactEmail,
    address: pair(v.addressEn, v.addressAr),
    defaultLocale: v.defaultLocale,
    seo: title || description ? { ...(title ? { title } : {}), ...(description ? { description } : {}) } : null,
  };
}
