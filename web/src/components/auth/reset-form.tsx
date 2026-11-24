"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/errors";
import { resetPassword } from "@/lib/auth/flows";
import { usePendingAuth } from "@/lib/auth/pending";
import { validateEmail, validateNewPassword, type FieldError } from "@/lib/auth/validation";

import { AuthShell, ErrorSummary, Field, PasswordRules, FormAlert, useErrorSummary } from "./auth-ui";
import { OTP_LENGTH, OtpInput } from "./otp-input";

/**
 * AUTH-03 step 2 (backend T-006). Every code failure is the same 400 OTP_INVALID, shown as
 * "invalid or expired" with a link to request a new code. Success is NOT a login: go to /login.
 */
export function ResetForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("auth.validation");
  const router = useRouter();
  const carried = usePendingAuth((s) => s.resetEmail);
  const setResetEmail = usePendingAuth((s) => s.setResetEmail);
  const [email, setEmail] = useState(carried ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: FieldError | null; password?: FieldError | null }>({});
  const [incomplete, setIncomplete] = useState(false);
  const [apiError, setApiError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const summary = useErrorSummary();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = { email: validateEmail(email), password: validateNewPassword(password) };
    setErrors(next);
    const short = code.length !== OTP_LENGTH;
    setIncomplete(short);
    if (next.email || next.password || short) {
      summary.fail(e.currentTarget);
      return;
    }
    summary.clear();
    setBusy(true);
    setApiError(null);
    try {
      await resetPassword(email.trim().toLowerCase(), code, password);
      setResetEmail(null);
      router.replace("/login?reset=1");
    } catch (err) {
      setApiError(err);
    } finally {
      setBusy(false);
    }
  }

  const invalidCode = apiError instanceof ApiError && apiError.code === "OTP_INVALID";

  return (
    <AuthShell>
      <h1 className="text-4xl">{t("resetTitle")}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        {carried ? <bdi>{t("resetIntro", { email: carried })}</bdi> : t("resetIntroNoEmail")}
      </p>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {invalidCode ? (
          <p role="alert" className="border-s-[3px] border-destructive bg-muted p-3 text-sm text-destructive">
            {t("codeInvalidReset")}{" "}
            <Link href="/forgot-password" className="underline">
              {t("requestNewCode")}
            </Link>
          </p>
        ) : (
          <FormAlert error={apiError} />
        )}
        <ErrorSummary show={summary.shown} />
        {carried ? null : (
          <Field label={t("email")} type="email" autoComplete="email" dir="ltr" value={email}
            onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        )}
        <OtpInput
          value={code}
          onChange={setCode}
          disabled={busy}
          invalid={incomplete || invalidCode}
          groupLabel={t("otpGroup")}
          label={(n) => t("otpDigit", { n })}
        />
        {incomplete ? (
          <p role="alert" className="text-center text-sm text-destructive">
            {tv("codeIncomplete")}
          </p>
        ) : null}
        <Field label={t("newPassword")} type="password" autoComplete="new-password" dir="ltr" maxLength={128}
          value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password}
          below={<PasswordRules value={password} />} />
        <Button type="submit" className="h-12 w-full" disabled={busy}>
          {busy ? t("submitting") : t("resetSubmit")}
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
