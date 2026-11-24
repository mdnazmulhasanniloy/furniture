"use client";

import { Check, Circle, Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Wordmark } from "@/components/brand";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/api/errors";
import type { FieldError } from "@/lib/auth/validation";
import { useCityCount } from "@/lib/site-facts";
import { cn } from "@/lib/utils";

/**
 * Auth layout (ADR-018, UI-04): a split screen. One side is a full-height lifestyle photo with the wordmark
 * and one true brand line (the photo is on the inline-start side, so it mirrors in RTL through grid order);
 * the other holds the form, centred, 440 px at most. Below lg the photo is a 28vh banner above the form.
 * The photo is a placeholder from the demo set until final photography exists (B-038).
 */
export function AuthShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const t = useTranslations("auth");
  const tHome = useTranslations("home");
  const cityCount = useCityCount();
  return (
    <main className="grid w-full lg:min-h-[calc(100svh-5rem)] lg:grid-cols-2" data-testid="auth-shell">
      <aside
        data-testid="auth-panel"
        className="relative h-[28vh] min-h-44 overflow-hidden bg-foreground text-primary-foreground lg:h-auto"
      >
        <Image
          src="/home/auth.jpg"
          alt=""
          fill
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover"
        />
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-foreground/85 via-foreground/55 to-foreground/30" />
        <div className="absolute inset-0 flex flex-col justify-between p-6 lg:p-12">
          <Wordmark name={tHome("brand")} className="self-start border-champagne text-2xl lg:text-3xl" />
          {cityCount > 0 ? (
            <p data-testid="brand-line" className="max-w-sm font-display text-xl font-bold leading-snug lg:text-4xl">
              {t("brand.line", { count: cityCount })}
            </p>
          ) : (
            <span />
          )}
        </div>
      </aside>
      <div className="flex items-center justify-center px-5 py-10 sm:px-8 lg:py-16">
        <div className="w-full max-w-[440px]">{children}</div>
      </div>
    </main>
  );
}

/**
 * Floating-label field. The label sits in the box and floats up on focus or when filled (CSS only, via the
 * placeholder-shown state). Password fields get a show/hide toggle. `dir="ltr"` fields (email, password) keep
 * their label and toggle on the physical left/right so they line up with the text, also in RTL.
 */
export function Field({
  label,
  error,
  hint,
  below,
  type,
  dir,
  className,
  ...props
}: React.ComponentProps<"input"> & {
  label: string;
  error?: FieldError | null;
  hint?: string;
  /** Always-visible helper under the field (e.g. the live password rules). */
  below?: React.ReactNode;
}) {
  const id = useId();
  const t = useTranslations("auth");
  const tv = useTranslations("auth.validation");
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";
  const ltr = dir === "ltr";
  const describedBy =
    [error ? `${id}-err` : null, hint && !error ? `${id}-hint` : null, below ? `${id}-below` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          id={id}
          type={isPassword && shown ? "text" : type}
          dir={dir}
          placeholder=" "
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "peer h-14 pb-1 pt-5 text-base placeholder:text-transparent",
            isPassword && (ltr ? "pr-12" : "pe-12"),
            className,
          )}
          {...props}
        />
        <label
          htmlFor={id}
          className={cn(
            "pointer-events-none absolute top-[18px] text-base text-muted-foreground transition-all duration-150",
            "peer-focus:top-2 peer-focus:text-xs peer-autofill:top-2 peer-autofill:text-xs",
            "peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-xs",
            ltr ? "left-3" : "start-3",
          )}
        >
          {label}
        </label>
        {isPassword ? (
          <button
            type="button"
            aria-label={shown ? t("field.hide") : t("field.show")}
            aria-pressed={shown}
            onClick={() => setShown((s) => !s)}
            className={cn(
              "absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              ltr ? "right-1" : "end-1",
            )}
          >
            {shown ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-err`} className="text-sm text-destructive">
          {tv(error)}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {below ? <div id={`${id}-below`}>{below}</div> : null}
    </div>
  );
}

/** Live password rules (UI-04). Exactly the rules `validateNewPassword` and the API enforce. */
export function PasswordRules({ value }: { value: string }) {
  const t = useTranslations("auth.rules");
  const items = [
    { key: "length", met: value.length >= 8 && value.length <= 128, text: t("length", { n: 8 }) },
    { key: "letter", met: /\p{L}/u.test(value), text: t("letter") },
    { key: "digit", met: /\p{N}/u.test(value), text: t("digit") },
  ];
  return (
    <div className="rounded-sm bg-blush p-3 text-xs text-blush-foreground" data-testid="password-rules">
      <p className="font-medium">{t("title")}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((r) => (
          <li
            key={r.key}
            data-met={r.met}
            className={cn("flex items-center gap-2", r.met ? "text-success-foreground" : "text-muted-foreground")}
          >
            {r.met ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
            <span className="sr-only">{r.met ? "✓" : "✗"}</span>
            {r.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** After a failed submit: a summary on top and focus on the first invalid field. */
export function useErrorSummary() {
  const [shown, setShown] = useState(false);
  return {
    shown,
    fail(form: HTMLFormElement) {
      setShown(true);
      setTimeout(() => form.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"] input')?.focus(), 0);
    },
    clear() {
      setShown(false);
    },
  };
}

export function ErrorSummary({ show }: { show: boolean }) {
  const t = useTranslations("auth.errors");
  if (!show) return null;
  return (
    <p role="alert" data-testid="error-summary" className="border-s-[3px] border-destructive bg-blush p-3 text-sm text-destructive">
      {t("summary")}
    </p>
  );
}

/** Localised API error (CLAUDE.md rule 8: never the API message). */
export function FormAlert({ error }: { error: unknown }) {
  const t = useTranslations("errors");
  if (!error) return null;
  return (
    <p role="alert" className="border-s-[3px] border-destructive bg-blush p-3 text-sm text-destructive">
      {apiErrorMessage(t as unknown as Parameters<typeof apiErrorMessage>[0], error)}
    </p>
  );
}

export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="border-s-[3px] border-success bg-blush p-3 text-sm text-success-foreground">
      {children}
    </p>
  );
}
