"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/errors";
import { register, resendVerifyOtp, verifyOtp, type Locale } from "@/lib/auth/flows";
import { usePendingAuth } from "@/lib/auth/pending";

import { AuthShell, FormAlert, FormNotice } from "./auth-ui";
import { OTP_LENGTH, OtpInput } from "./otp-input";
import { RESEND_SECONDS, useCountdown } from "./use-countdown";

/** AUTH-01 verify + AUTH-04 resend (60 s countdown). */
export function VerifyForm() {
  const t = useTranslations("auth");
  const tv = useTranslations("auth.validation");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pending = usePendingAuth((s) => s.pending);
  const clearPending = usePendingAuth((s) => s.clear);
  const [code, setCode] = useState("");
  const [apiError, setApiError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const [expiredNoData, setExpiredNoData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, restart] = useCountdown(RESEND_SECONDS);

  // No in-memory registration (e.g. page reloaded): nothing to verify, start again.
  useEffect(() => {
    if (!pending) router.replace("/register");
  }, [pending, router]);
  if (!pending) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    if (code.length !== OTP_LENGTH) {
      setIncomplete(true);
      return;
    }
    setIncomplete(false);
    setBusy(true);
    setApiError(null);
    setNotice(null);
    try {
      await verifyOtp(pending.email, code);
      clearPending();
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError && err.code === "OTP_EXPIRED") {
        await recoverExpired(pending);
      } else {
        setApiError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  /** OTP_EXPIRED: a resend finds no pending row, so re-submit the register request. */
  async function recoverExpired(p: NonNullable<typeof pending>) {
    setCode("");
    if (!p.firstName || !p.lastName) {
      setExpiredNoData(true);
      return;
    }
    try {
      await register({
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        password: p.password,
        preferredLocale: locale,
      });
      setNotice(t("newCodeSent"));
      restart(RESEND_SECONDS);
    } catch (err) {
      setApiError(err);
      if (err instanceof ApiError && err.retryAfterSeconds) restart(err.retryAfterSeconds);
    }
  }

  async function onResend() {
    if (!pending || seconds > 0) return;
    setApiError(null);
    setNotice(null);
    try {
      await resendVerifyOtp(pending.email, pending.password);
      setNotice(t("codeSentAgain"));
      restart(RESEND_SECONDS);
    } catch (err) {
      setApiError(err);
      if (err instanceof ApiError && err.status === 429) {
        restart(err.retryAfterSeconds ?? RESEND_SECONDS);
      }
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-3xl">{t("verifyTitle")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("verifyIntro")}</p>
      <p className="mt-1 mb-6 text-sm text-foreground">
        <bdi>{t("otpSent", { email: pending.email })}</bdi>
      </p>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {notice ? <FormNotice>{notice}</FormNotice> : null}
        <FormAlert error={apiError} />
        {expiredNoData ? (
          <p role="alert" className="text-sm text-destructive">
            {t("expiredStartOver")}{" "}
            <Link href="/register" className="underline">
              {t("register")}
            </Link>
          </p>
        ) : null}
        <OtpInput
          value={code}
          onChange={setCode}
          disabled={busy}
          invalid={incomplete}
          groupLabel={t("otpGroup")}
          label={(n) => t("otpDigit", { n })}
        />
        {incomplete ? (
          <p role="alert" className="text-center text-sm text-destructive">
            {tv("codeIncomplete")}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t("submitting") : t("verifySubmit")}
        </Button>
      </form>
      <div className="mt-4 text-center">
        {seconds > 0 ? (
          <span className="text-sm text-muted-foreground" aria-live="off" data-testid="resend-countdown">
            {t("resendIn", { seconds })}
          </span>
        ) : (
          <Button type="button" variant="link" onClick={onResend}>
            {t("resend")}
          </Button>
        )}
      </div>
    </AuthShell>
  );
}
