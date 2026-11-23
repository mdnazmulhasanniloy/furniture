"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProfile, type ProfilePatch } from "@/lib/account/api";
import { apiErrorMessage } from "@/lib/api/errors";
import { useAuthStore } from "@/lib/auth/store";
import { normalizeSaudiPhone } from "@/lib/format/phone";

type Field = "firstName" | "lastName" | "phone";

/**
 * PROF-01: first name, last name, phone (Saudi mobile, NFR-06) and preferred language. Email is shown
 * read-only (changing it is out of scope). No avatar field (backend T-028 delivers avatar editing).
 */
export function ProfileForm() {
  const t = useTranslations("account.profile");
  const tv = useTranslations("checkout");
  const te = useTranslations("errors");
  const uid = useId();
  const user = useAuthStore((s) => s.user)!;
  const [v, setV] = useState({
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ? user.phone.replace(/^\+966/, "") : "",
    preferredLocale: user.preferredLocale,
  });
  const [errors, setErrors] = useState<Partial<Record<Field, "required" | "phone" | "tooLong">>>({});
  const [apiError, setApiError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: typeof errors = {};
    const first = v.firstName.trim();
    const last = v.lastName.trim();
    if (!first) next.firstName = "required";
    else if (first.length > 40) next.firstName = "tooLong";
    if (!last) next.lastName = "required";
    else if (last.length > 40) next.lastName = "tooLong";
    const phoneRaw = v.phone.trim();
    const phone = phoneRaw ? normalizeSaudiPhone(phoneRaw) : null;
    if (phoneRaw && !phone) next.phone = "phone";
    setErrors(next);
    setSaved(false);
    if (Object.keys(next).length > 0) return;

    // Partial update: only what changed (PATCH /me needs at least one field; unknown fields are 422).
    const patch: ProfilePatch = {};
    if (first !== user.firstName) patch.firstName = first;
    if (last !== user.lastName) patch.lastName = last;
    if (phone !== (user.phone ?? null)) patch.phone = phone;
    if (v.preferredLocale !== user.preferredLocale) patch.preferredLocale = v.preferredLocale;
    if (Object.keys(patch).length === 0) {
      setSaved(true);
      return;
    }
    setBusy(true);
    setApiError(null);
    try {
      const updated = await updateProfile(patch);
      useAuthStore.getState().setUser({ ...user, ...updated });
      setSaved(true);
    } catch (err) {
      setApiError(err);
    } finally {
      setBusy(false);
    }
  }

  const err = (k: Field) =>
    errors[k] ? (
      <p id={`${uid}-${k}-err`} className="text-sm text-destructive">{tv(`validation.${errors[k]}`)}</p>
    ) : null;
  const aria = (k: Field) => ({
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? `${uid}-${k}-err` : undefined,
  });

  return (
    <form onSubmit={submit} noValidate className="max-w-xl space-y-4" data-testid="profile-form" aria-label={t("title")}>
      <h2 className="font-display text-lg font-semibold">{t("title")}</h2>
      {apiError ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {apiErrorMessage(te as unknown as Parameters<typeof apiErrorMessage>[0], apiError)}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm" data-testid="profile-saved">
          {t("saved")}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-first`} className="text-sm font-medium">{t("firstName")}</label>
          <Input id={`${uid}-first`} value={v.firstName} maxLength={40} autoComplete="given-name" onChange={(e) => setV((s) => ({ ...s, firstName: e.target.value }))} {...aria("firstName")} />
          {err("firstName")}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${uid}-last`} className="text-sm font-medium">{t("lastName")}</label>
          <Input id={`${uid}-last`} value={v.lastName} maxLength={40} autoComplete="family-name" onChange={(e) => setV((s) => ({ ...s, lastName: e.target.value }))} {...aria("lastName")} />
          {err("lastName")}
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-email`} className="text-sm font-medium">{t("email")}</label>
        <Input id={`${uid}-email`} value={user.email} readOnly dir="ltr" className="text-start" />
        <p className="text-xs text-muted-foreground">{t("emailHint")}</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-phone`} className="text-sm font-medium">{t("phone")}</label>
        <div className="flex items-stretch" dir="ltr">
          <span className="inline-flex items-center rounded-s-md border border-e-0 border-input bg-muted px-3 text-sm text-muted-foreground">
            {tv("phonePrefix")}
          </span>
          <Input id={`${uid}-phone`} type="tel" inputMode="tel" autoComplete="tel-national" value={v.phone} maxLength={25} className="rounded-s-none" onChange={(e) => setV((s) => ({ ...s, phone: e.target.value }))} {...aria("phone")} />
        </div>
        {err("phone")}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-lang`} className="text-sm font-medium">{t("language")}</label>
        <select
          id={`${uid}-lang`}
          value={v.preferredLocale}
          onChange={(e) => setV((s) => ({ ...s, preferredLocale: e.target.value as "ar" | "en" }))}
          className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="ar">{t("languageAr")}</option>
          <option value="en">{t("languageEn")}</option>
        </select>
      </div>
      <Button type="submit" disabled={busy}>{busy ? tv("form.saving") : t("save")}</Button>
    </form>
  );
}
