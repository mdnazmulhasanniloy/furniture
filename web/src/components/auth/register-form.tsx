"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { register, type Locale } from "@/lib/auth/flows";
import { usePendingAuth } from "@/lib/auth/pending";
import {
  validateEmail,
  validateNewPassword,
  validateRequired,
  type FieldError,
} from "@/lib/auth/validation";

import { AuthShell, Field, FormAlert } from "./auth-ui";

/** AUTH-01: register, then the OTP screen. Form data is kept in memory only. */
export function RegisterForm() {
  const t = useTranslations("auth");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const setPending = usePendingAuth((s) => s.setPending);
  const [v, setV] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof v, FieldError | null>>>({});
  const [apiError, setApiError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = {
      firstName: validateRequired(v.firstName),
      lastName: validateRequired(v.lastName),
      email: validateEmail(v.email),
      password: validateNewPassword(v.password),
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setBusy(true);
    setApiError(null);
    const data = {
      firstName: v.firstName.trim(),
      lastName: v.lastName.trim(),
      email: v.email.trim().toLowerCase(),
      password: v.password,
    };
    try {
      await register({ ...data, preferredLocale: locale });
      setPending(data);
      router.push("/verify");
    } catch (err) {
      setApiError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-3xl">{t("registerTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{t("registerIntro")}</p>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert error={apiError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("firstName")} autoComplete="given-name" maxLength={40} value={v.firstName}
            onChange={set("firstName")} error={errors.firstName} />
          <Field label={t("lastName")} autoComplete="family-name" maxLength={40} value={v.lastName}
            onChange={set("lastName")} error={errors.lastName} />
        </div>
        <Field label={t("email")} type="email" autoComplete="email" dir="ltr" value={v.email}
          onChange={set("email")} error={errors.email} />
        <Field label={t("password")} type="password" autoComplete="new-password" dir="ltr" maxLength={128}
          value={v.password} onChange={set("password")} error={errors.password} hint={t("passwordHint")} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t("submitting") : t("register")}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          {t("login")}
        </Link>
      </p>
    </AuthShell>
  );
}
