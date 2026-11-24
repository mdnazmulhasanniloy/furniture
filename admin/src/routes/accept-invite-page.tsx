import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";

import { PasswordRules } from "@/components/password-rules";
import { isStrongPassword } from "@/lib/password-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import { acceptInvite } from "@/lib/auth/flows";
import { useAuth } from "@/lib/auth/use-auth";
import { toAsciiDigits } from "@/lib/utils";
import { PublicFrame } from "./public-frame";

// api-spec accept-invite: 6-digit code, and the one password policy (src/lib/password-policy.ts, owner
// 2026-11-24), the same file the API enforces. The live checklist under the field shows which rule is unmet.
const schema = z.object({
  email: z.string().trim().email("invalidEmail"),
  code: z.string().regex(/^[0-9]{6}$/, "invalidCode"),
  password: z.string().max(128, "passwordWeak").refine(isStrongPassword, "passwordWeak"),
});
type Values = z.infer<typeof schema>;

export function AcceptInvitePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const auth = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [hintNewInvite, setHintNewInvite] = useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: params.get("email") ?? "", code: "", password: "" },
  });

  const password = watch("password"); // drives the live checklist

  if (auth.status === "authenticated") return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    setHintNewInvite(false);
    try {
      await acceptInvite(v.email, v.code, v.password);
      navigate("/", { replace: true });
    } catch (e) {
      setServerError(errorMessage(t, i18n.language, e));
      // 400 OTP_INVALID: generic message plus a hint. 422 keeps the typed code usable (the form is not reset).
      setHintNewInvite(e instanceof ApiError && e.code === "OTP_INVALID");
    }
  });

  return (
    <PublicFrame>
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-sm"
        aria-labelledby="invite-title"
      >
        <h2 id="invite-title" className="text-lg font-semibold">
          {t("auth.inviteTitle")}
        </h2>
        <label className="flex flex-col gap-1 text-sm">
          {t("auth.email")}
          <Input type="email" autoComplete="username" dir="ltr" aria-invalid={!!errors.email} {...register("email")} />
          {errors.email && (
            <span role="alert" className="text-destructive">
              {t(`auth.${errors.email.message}`)}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("auth.code")}
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            dir="ltr"
            aria-invalid={!!errors.code}
            {...register("code", { setValueAs: toAsciiDigits })}
          />
          {errors.code && (
            <span role="alert" className="text-destructive">
              {t(`auth.${errors.code.message}`)}
            </span>
          )}
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="invite-password">{t("auth.newPassword")}</label>
          <Input
            id="invite-password"
            type="password"
            autoComplete="new-password"
            dir="ltr"
            aria-invalid={!!errors.password}
            aria-describedby="pw-rule"
            {...register("password")}
          />
          <PasswordRules value={password} id="pw-rule" />
          {errors.password && (
            <span role="alert" className="text-destructive">
              {t(`auth.${errors.password.message}`)}
            </span>
          )}
        </div>
        {serverError && (
          <div role="alert" data-testid="invite-error" className="text-sm text-destructive">
            <p>{serverError}</p>
            {hintNewInvite && <p data-testid="invite-hint">{t("auth.inviteHint")}</p>}
          </div>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {t("auth.inviteSubmit")}
        </Button>
      </form>
    </PublicFrame>
  );
}
