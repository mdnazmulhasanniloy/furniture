"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { KernedText } from "@/components/kerned-text";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { register, type Locale } from "@/lib/auth/flows";
import { accountTarget, safeNext } from "@/lib/auth/next-path";
import { usePendingAuth } from "@/lib/auth/pending";
import { useAuthStore } from "@/lib/auth/store";
import {
  validateEmail,
  validateNewPassword,
  validateRequired,
  type FieldError,
} from "@/lib/auth/validation";

import { AuthShell, ErrorSummary, Field, PasswordRules, FormAlert, useErrorSummary } from "./auth-ui";

/**
 * AUTH-01: register, then the OTP screen. Form data is kept in memory only.
 *
 * `next` (QA B2): a visitor who is already signed in has nothing to register, so they go to that path
 * (same-origin only) or to the account page; it also travels with the pending registration so the
 * verify screen can continue there.
 */
export function RegisterForm({ next }: { next?: string } = {}) {
  const t = useTranslations("auth");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const target = accountTarget(next, locale);
  // Captured here: `next` is shadowed inside onSubmit by the validation result.
  const continueTo = safeNext(next, locale) ?? undefined;
  const setPending = usePendingAuth((s) => s.setPending);
  useEffect(() => {
    if (status === "authenticated") router.replace(target);
  }, [status, router, target]);
  const [v, setV] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof v, FieldError | null>>>({});
  const [apiError, setApiError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const summary = useErrorSummary();
  const rules: Record<keyof typeof v, (x: string) => FieldError | null> = {
    firstName: validateRequired,
    lastName: validateRequired,
    email: validateEmail,
    password: validateNewPassword,
  };
  // Inline validation (W-06): on blur, then live while an error is shown.
  const check = (k: keyof typeof v, value: string) =>
    setErrors((e) => ({ ...e, [k]: rules[k](value) }));
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setV((s) => ({ ...s, [k]: value }));
    if (errors[k]) check(k, value);
  };
  const blur = (k: keyof typeof v) => (e: React.FocusEvent<HTMLInputElement>) => check(k, e.target.value);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = {
      firstName: validateRequired(v.firstName),
      lastName: validateRequired(v.lastName),
      email: validateEmail(v.email),
      password: validateNewPassword(v.password),
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) {
      summary.fail(e.currentTarget);
      return;
    }
    summary.clear();
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
      setPending({ ...data, next: continueTo });
      router.push("/verify");
    } catch (err) {
      setApiError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-4xl md:text-5xl"><KernedText>{t("registerTitle")}</KernedText></h1>
      <p className="mt-2 mb-8 text-base text-muted-foreground">{t("registerIntro")}</p>
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <ErrorSummary show={summary.shown} />
        <FormAlert error={apiError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("firstName")} autoComplete="given-name" maxLength={40} value={v.firstName}
            onChange={set("firstName")} onBlur={blur("firstName")} error={errors.firstName} />
          <Field label={t("lastName")} autoComplete="family-name" maxLength={40} value={v.lastName}
            onChange={set("lastName")} onBlur={blur("lastName")} error={errors.lastName} />
        </div>
        <Field label={t("email")} type="email" autoComplete="email" dir="ltr" value={v.email}
          onChange={set("email")} onBlur={blur("email")} error={errors.email} />
        <Field label={t("password")} type="password" autoComplete="new-password" dir="ltr" maxLength={128}
          value={v.password} onChange={set("password")} onBlur={blur("password")} error={errors.password} below={<PasswordRules value={v.password} />} />
        <Button type="submit" className="h-[52px] w-full text-base" disabled={busy}>
          {busy ? t("submitting") : t("register")}
        </Button>
      </form>
      <p className="mt-8 text-base text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          {t("login")}
        </Link>
      </p>
    </AuthShell>
  );
}
