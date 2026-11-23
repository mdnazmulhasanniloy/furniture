"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/i18n/routing";
import { apiErrorMessage } from "@/lib/api/errors";
import { updateAddress } from "@/lib/account/api";
import { createAddress, type Address } from "@/lib/checkout/api";
import { normalizeSaudiPhone } from "@/lib/format/phone";
import { pick, type LocalizedText } from "@/lib/pick";

export type CityOption = { code: string; name: LocalizedText };

type Errors = Partial<Record<"label" | "fullName" | "phone" | "cityCode" | "area" | "street" | "notes", "required" | "phone" | "tooLong">>;

/** Inline address add (PROF-02, W-05): city is a Select of active cities; phone has a fixed +966 prefix. */
export function AddressForm({
  cities,
  onCreated,
  onCancel,
  address,
  showDefault = false,
}: {
  cities: CityOption[];
  /** Called with the saved address (created or edited). */
  onCreated: (a: Address) => void;
  onCancel?: () => void;
  /** Edit mode (PROF-02 account area): PATCH /me/addresses/{id}. A city that is no longer active is not preselected. */
  address?: Address;
  /** Show the "Set as default" checkbox (account area). */
  showDefault?: boolean;
}) {
  const t = useTranslations("checkout");
  const te = useTranslations("errors");
  const locale = useLocale() as Locale;
  const uid = useId();
  const [v, setV] = useState(() => ({
    label: address?.label ?? "",
    fullName: address?.fullName ?? "",
    phone: address ? address.phone.replace(/^\+966/, "") : "",
    // An address in a deactivated city must get an active city picked (PROF-02).
    cityCode: address && cities.some((c) => c.code === address.cityCode) ? address.cityCode : "",
    area: address?.area ?? "",
    street: address?.street ?? "",
    notes: address?.notes ?? "",
  }));
  const [makeDefault, setMakeDefault] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [apiError, setApiError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const phone = normalizeSaudiPhone(v.phone);
    const next: Errors = {};
    const need = (k: "label" | "fullName" | "cityCode" | "area" | "street", max: number) => {
      const s = v[k].trim();
      if (!s) next[k] = "required";
      else if (s.length > max) next[k] = "tooLong";
    };
    need("label", 30);
    need("fullName", 80);
    need("cityCode", 100);
    need("area", 80);
    need("street", 200);
    if (!phone) next.phone = "phone";
    if (v.notes.trim().length > 300) next.notes = "tooLong";
    setErrors(next);
    if (Object.keys(next).length > 0 || !phone) return;
    setBusy(true);
    setApiError(null);
    try {
      const body = {
        label: v.label.trim(),
        fullName: v.fullName.trim(),
        phone,
        cityCode: v.cityCode,
        area: v.area.trim(),
        street: v.street.trim(),
      };
      const wantDefault = showDefault && makeDefault && !address?.isDefault;
      const saved = address
        ? await updateAddress(address.id, { ...body, notes: v.notes.trim(), ...(wantDefault ? { isDefault: true } : {}) })
        : await createAddress({
            ...body,
            ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
            ...(wantDefault ? { isDefault: true } : {}),
          });
      onCreated(saved);
    } catch (err) {
      setApiError(err);
    } finally {
      setBusy(false);
    }
  }

  const err = (k: keyof Errors) =>
    errors[k] ? (
      <p id={`${uid}-${k}-err`} className="text-sm text-destructive">
        {t(`validation.${errors[k]}`)}
      </p>
    ) : null;
  const aria = (k: keyof Errors) => ({
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? `${uid}-${k}-err` : undefined,
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid="address-form" aria-label={address ? t("editAddress") : t("newAddress")}>
      {apiError ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {apiErrorMessage(te as unknown as Parameters<typeof apiErrorMessage>[0], apiError)}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-label`} className="text-sm font-medium">{t("form.label")}</label>
          <Input id={`${uid}-label`} value={v.label} onChange={set("label")} maxLength={30} {...aria("label")} />
          {err("label")}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-fullName`} className="text-sm font-medium">{t("form.fullName")}</label>
          <Input id={`${uid}-fullName`} value={v.fullName} onChange={set("fullName")} autoComplete="name" maxLength={80} {...aria("fullName")} />
          {err("fullName")}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-phone`} className="text-sm font-medium">{t("form.phone")}</label>
          <div className="flex items-stretch" dir="ltr">
            <span className="inline-flex items-center rounded-s-md border border-e-0 border-input bg-muted px-3 text-sm text-muted-foreground">
              {t("phonePrefix")}
            </span>
            <Input id={`${uid}-phone`} type="tel" inputMode="tel" autoComplete="tel-national" value={v.phone} onChange={set("phone")} maxLength={25} className="rounded-s-none" {...aria("phone")} />
          </div>
          {err("phone")}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-city`} className="text-sm font-medium">{t("form.city")}</label>
          <select
            id={`${uid}-city`}
            value={v.cityCode}
            onChange={set("cityCode")}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
            {...aria("cityCode")}
          >
            <option value="">{t("cityPlaceholder")}</option>
            {cities.map((c) => (
              <option key={c.code} value={c.code}>{pick(c.name, locale) || c.code}</option>
            ))}
          </select>
          {err("cityCode")}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-area`} className="text-sm font-medium">{t("form.area")}</label>
          <Input id={`${uid}-area`} value={v.area} onChange={set("area")} maxLength={80} {...aria("area")} />
          {err("area")}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-street`} className="text-sm font-medium">{t("form.street")}</label>
          <Input id={`${uid}-street`} value={v.street} onChange={set("street")} autoComplete="street-address" maxLength={200} {...aria("street")} />
          {err("street")}
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-notes`} className="text-sm font-medium">{t("form.notes")}</label>
        <Input id={`${uid}-notes`} value={v.notes} onChange={set("notes")} maxLength={300} {...aria("notes")} />
        {err("notes")}
      </div>
      {showDefault && !address?.isDefault ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="size-4 accent-primary" />
          {t("form.makeDefault")}
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? t("form.saving") : t("form.save")}</Button>
        {onCancel ? <Button type="button" variant="outline" onClick={onCancel}>{t("form.cancel")}</Button> : null}
      </div>
    </form>
  );
}
