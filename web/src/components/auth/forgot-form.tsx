"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { forgotPassword } from "@/lib/auth/flows";
import { usePendingAuth } from "@/lib/auth/pending";
import { validateEmail, type FieldError } from "@/lib/auth/validation";

import { AuthShell, Field, FormAlert } from "./auth-ui";

/** AUTH-03 step 1. The API answers 200 for every email, so we always move on. */
export function ForgotForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const setResetEmail = usePendingAuth((s) => s.setResetEmail);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<FieldError | null>(null);
  const [apiError, setApiError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateEmail(email);
    setError(err);
    if (err) return;
    setBusy(true);
    setApiError(null);
    try {
      const clean = email.trim().toLowerCase();
      await forgotPassword(clean);
      setResetEmail(clean);
      router.push("/reset-password");
    } catch (e2) {
      setApiError(e2);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-3xl">{t("forgotTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{t("forgotIntro")}</p>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert error={apiError} />
        <Field label={t("email")} type="email" autoComplete="email" dir="ltr" value={email}
          onChange={(e) => setEmail(e.target.value)} error={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t("submitting") : t("sendCode")}
        </Button>
      </form>
      <p className="mt-6 text-sm">
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          {t("backToLogin")}
        </Link>
      </p>
    </AuthShell>
  );
}
