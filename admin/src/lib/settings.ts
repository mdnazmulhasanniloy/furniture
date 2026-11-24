import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api/client";
import {
  isContactPhoneInput,
  normalizeSaudiContactPhone,
  SAUDI_CONTACT_PHONE_MAX_LENGTH,
} from "@/lib/contact-phone";
import { halalasToSar, parseSar } from "@/lib/money";
import type { LocalizedText, StoredImage } from "@/lib/products";
import { bpToRate, isRegistrationNumber, parseRate, rateToText, readVat, type VatSetting } from "@/lib/vat";

// api-spec.yaml /admin/settings (ADM-09). PUT is a FULL REPLACE with `expectedUpdatedAt` (409
// STALE_UPDATE, owner 2026-11-22). Contact email and phone are optional and editable here (owner
// 2026-11-24: empty publishes none, the storefront then hides the line). Social links, whose rules are
// still blocked (B-034), are sent back exactly as received. Delivery
// fee, threshold and cities (T-073) are edited on the Delivery tab, VAT (T-074) on the VAT tab.

export type DeliveryCity = {
  code: string;
  name: LocalizedText;
  isActive: boolean;
  sortOrder: number;
  /** Per-city fee override in halalas; null = use the base fee (api-spec DeliveryCity.deliveryFee). */
  deliveryFee?: number | null;
};

export type DeliveryEdit = {
  deliveryFee: number;
  freeDeliveryThreshold: number | null;
  deliveryCities: DeliveryCity[];
};

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
  deliveryCities: DeliveryCity[];
  defaultLocale: "ar" | "en";
  seo?: { title?: LocalizedText; description?: LocalizedText } | null;
  updatedAt: string;
};

export type SettingsEdit = {
  storeName: LocalizedText;
  logo: { key: string; alt?: LocalizedText } | null;
  contactEmail: string;
  /** Normalised `+966XXXXXXXXX`, or "" to publish no phone (B-033, owner 2026-11-24). */
  contactPhone: string;
  address: LocalizedText | null;
  defaultLocale: "ar" | "en";
  seo: { title?: LocalizedText; description?: LocalizedText } | null;
  /** Delivery tab values; when absent the loaded fee, threshold and cities are sent back untouched. */
  delivery?: DeliveryEdit;
  /** VAT tab values; when absent the loaded `vat` object is sent back untouched. */
  vat?: VatSetting;
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
    contactPhone: edit.contactPhone,
    address: edit.address,
    deliveryFee: edit.delivery ? edit.delivery.deliveryFee : base.deliveryFee,
    vat: edit.vat ?? base.vat,
    deliveryCities: edit.delivery ? edit.delivery.deliveryCities : base.deliveryCities,
    defaultLocale: edit.defaultLocale,
  };
  if (base.socials) body.socials = base.socials;
  if (edit.delivery) body.freeDeliveryThreshold = edit.delivery.freeDeliveryThreshold;
  else if (base.freeDeliveryThreshold !== undefined) body.freeDeliveryThreshold = base.freeDeliveryThreshold;
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
// Base fee: required (default 0). Threshold: optional, empty = no threshold. SAR, at most 2 decimals.
function sarRule(optional: boolean) {
  return (v: string, ctx: z.RefinementCtx) => {
    if (optional && v.trim() === "") return;
    const p = parseSar(v);
    if (!p.ok) ctx.addIssue({ code: "custom", message: p.reason === "negative" ? "settings.delivery.negative" : "settings.delivery.invalidAmount" });
  };
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const settingsSchema = z
  .object({
    storeNameEn: z.string().trim().min(1, "settings.form.required").max(120, "settings.form.tooLong"),
    storeNameAr: z.string().trim().min(1, "settings.form.required").max(120, "settings.form.tooLong"),
    addressEn: z.string().trim().max(300, "settings.form.tooLong"),
    addressAr: z.string().trim().max(300, "settings.form.tooLong"),
    // Optional since 2026-11-24 (owner): an empty email clears it and the storefront hides the line, so
    // saving the VAT or delivery tabs never depends on contact details. A typed value must still be valid.
    contactEmail: z
      .string()
      .trim()
      .max(120, "settings.form.tooLong")
      .refine((v) => v === "" || EMAIL.test(v), "settings.form.emailInvalid"),
    // Editable since 2026-11-24 (B-033 resolved): empty is allowed, anything else must be a Saudi number
    // (mobile, landline or unified 9200/800), checked with the same rule as the API.
    contactPhone: z
      .string()
      .trim()
      .max(SAUDI_CONTACT_PHONE_MAX_LENGTH, "settings.form.tooLong")
      .refine(isContactPhoneInput, "settings.form.phoneInvalid"),
    defaultLocale: z.enum(["ar", "en"]),
    seoTitleEn: z.string().trim().max(120, "settings.form.tooLong"),
    seoTitleAr: z.string().trim().max(120, "settings.form.tooLong"),
    seoDescEn: z.string().trim().max(300, "settings.form.tooLong"),
    seoDescAr: z.string().trim().max(300, "settings.form.tooLong"),
    deliveryFee: z.string().superRefine(sarRule(false)),
    freeThreshold: z.string().superRefine(sarRule(true)),
    vatRate: z.string().superRefine((v, ctx) => {
      const p = parseRate(v);
      if (!p.ok) ctx.addIssue({ code: "custom", message: p.reason === "range" ? "settings.vat.rateRange" : "settings.vat.rateInvalid" });
    }),
    vatApplyDelivery: z.boolean(),
    vatInclusive: z.boolean(),
    vatNumber: z.string().trim().refine((v) => v === "" || isRegistrationNumber(v), "settings.vat.numberInvalid"),
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
    contactPhone: s.contactPhone,
    defaultLocale: s.defaultLocale === "en" ? "en" : "ar",
    seoTitleEn: s.seo?.title?.en ?? "",
    seoTitleAr: s.seo?.title?.ar ?? "",
    seoDescEn: s.seo?.description?.en ?? "",
    seoDescAr: s.seo?.description?.ar ?? "",
    deliveryFee: halalasToSar(s.deliveryFee ?? 0),
    freeThreshold: s.freeDeliveryThreshold == null ? "" : halalasToSar(s.freeDeliveryThreshold),
    vatRate: rateToText(readVat(s.vat).vatRate),
    vatApplyDelivery: readVat(s.vat).applyToDelivery,
    vatInclusive: readVat(s.vat).pricesIncludeVat,
    vatNumber: readVat(s.vat).registrationNumber ?? "",
  };
}

export function formToEdit(
  v: SettingsFormValues,
  logo: SettingsEdit["logo"],
  deliveryCities?: DeliveryCity[],
  base?: SiteSettings,
): SettingsEdit {
  const pair = (en: string, ar: string) => (en && ar ? { en, ar } : null);
  const title = pair(v.seoTitleEn, v.seoTitleAr);
  const description = pair(v.seoDescEn, v.seoDescAr);
  return {
    storeName: { en: v.storeNameEn, ar: v.storeNameAr },
    logo,
    contactEmail: v.contactEmail,
    // Stored canonical, so the value that comes back is the value the form will load next time.
    contactPhone: normalizeSaudiContactPhone(v.contactPhone) ?? "",
    address: pair(v.addressEn, v.addressAr),
    defaultLocale: v.defaultLocale,
    delivery: deliveryCities && {
      deliveryFee: (parseSar(v.deliveryFee) as { halalas: number }).halalas,
      freeDeliveryThreshold: v.freeThreshold.trim() === "" ? null : (parseSar(v.freeThreshold) as { halalas: number }).halalas,
      deliveryCities,
    },
    // Keep any other loaded `vat` keys (spread) and overwrite only what the VAT tab owns.
    vat: base && {
      ...readVat(base.vat),
      vatRate: bpToRate((parseRate(v.vatRate) as { bp: number }).bp),
      applyToDelivery: v.vatApplyDelivery,
      pricesIncludeVat: v.vatInclusive,
      registrationNumber: v.vatNumber.trim() === "" ? null : v.vatNumber.trim(),
    },
    seo: title || description ? { ...(title ? { title } : {}), ...(description ? { description } : {}) } : null,
  };
}
