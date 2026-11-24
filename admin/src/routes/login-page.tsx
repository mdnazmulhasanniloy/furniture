import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/messages";
import { login } from "@/lib/auth/flows";
import { useAuth } from "@/lib/auth/use-auth";
import { PublicFrame } from "./public-frame";

const schema = z.object({ email: z.string().trim().email("invalidEmail"), password: z.string().min(1, "required") });
type Values = z.infer<typeof schema>;

/** Only same-app paths are followed after sign-in (no open redirect). */
export function safeFrom(from: unknown): string {
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/login")
    ? from
    : "/";
}

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const from = safeFrom((location.state as { from?: string } | null)?.from);

  if (auth.status === "authenticated") return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    try {
      await login(v.email, v.password);
      navigate(from, { replace: true });
    } catch (e) {
      setServerError(errorMessage(t, i18n.language, e));
    }
  });

  return (
    <PublicFrame>
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-sm"
        aria-labelledby="login-title"
      >
        <h2 id="login-title" className="text-lg font-semibold">
          {t("auth.loginTitle")}
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
          {t("auth.password")}
          <Input
            type="password"
            autoComplete="current-password"
            dir="ltr"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          {errors.password && (
            <span role="alert" className="text-destructive">
              {t(`auth.${errors.password.message}`)}
            </span>
          )}
        </label>
        {serverError && (
          <p role="alert" data-testid="login-error" className="text-sm text-destructive">
            {serverError}
          </p>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {t("auth.signIn")}
        </Button>
      </form>
    </PublicFrame>
  );
}
