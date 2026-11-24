"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/errors";
import { login } from "@/lib/auth/session";
import { usePendingAuth } from "@/lib/auth/pending";
import { useAuthStore } from "@/lib/auth/store";
import { validateEmail, type FieldError } from "@/lib/auth/validation";

import { AuthShell, ErrorSummary, Field, FormAlert, FormNotice, useErrorSummary } from "./auth-ui";

/** AUTH-02. `resetDone` shows the post-reset notice (AUTH-03 sends users here). */
export function LoginForm({ resetDone = false }: { resetDone?: boolean }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const setPending = usePendingAuth((s) => s.setPending);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: FieldError | null; password?: FieldError | null }>({});
  const [apiError, setApiError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const summary = useErrorSummary();

  // Inline validation (W-06): on blur, then live while an error is shown.
  const checkEmail = (v: string) => setErrors((e) => ({ ...e, email: validateEmail(v) }));
  const checkPassword = (v: string) => setErrors((e) => ({ ...e, password: v ? null : ("required" as const) }));

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = { email: validateEmail(email), password: password ? null : ("required" as const) };
    setErrors(next);
    if (next.email || next.password) {
      summary.fail(e.currentTarget);
      return;
    }
    summary.clear();
    setBusy(true);
    setApiError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
        // The API re-sent an OTP (api-spec.yaml /auth/login): go to the verify screen.
        setPending({ email: email.trim().toLowerCase(), password });
        router.push("/verify");
        return;
      }
      setApiError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="text-4xl">{t("loginTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{t("loginIntro")}</p>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {resetDone ? <FormNotice>{t("resetDone")}</FormNotice> : null}
        <ErrorSummary show={summary.shown} />
        <FormAlert error={apiError} />
        <Field label={t("email")} type="email" autoComplete="email" dir="ltr" value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) checkEmail(e.target.value);
          }}
          onBlur={(e) => checkEmail(e.target.value)} error={errors.email} />
        <Field label={t("password")} type="password" autoComplete="current-password" dir="ltr" value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errors.password) checkPassword(e.target.value);
          }}
          onBlur={(e) => checkPassword(e.target.value)} error={errors.password} />
        <div className="text-end">
          <Link href="/forgot-password" className="text-sm text-primary underline-offset-4 hover:underline">
            {t("forgot")}
          </Link>
        </div>
        <Button type="submit" className="h-12 w-full" disabled={busy}>
          {busy ? t("submitting") : t("login")}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        {t("noAccount")}{" "}
        <Link href="/register" className="text-primary underline-offset-4 hover:underline">
          {t("register")}
        </Link>
      </p>
    </AuthShell>
  );
}
