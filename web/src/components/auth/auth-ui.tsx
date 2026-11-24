"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { ImagePlaceholder, Wordmark } from "@/components/brand";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/api/errors";
import type { FieldError } from "@/lib/auth/validation";

/**
 * Split layout (W-06, CR-007): form on the start side; from lg a large lifestyle image panel on the end
 * side (emerald placeholder until real photos exist, B-022) with an emerald caption panel that carries a
 * gold accent line. The panel is decorative (aria-hidden). Mirrors in RTL through grid order.
 */
export function AuthShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const t = useTranslations("auth");
  const tHome = useTranslations("home");
  return (
    <main className="mx-auto grid min-h-[70vh] w-full max-w-6xl lg:grid-cols-2" data-testid="auth-shell">
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Wordmark name={tHome("brand")} className="mb-8 text-2xl text-primary" />
          {children}
        </div>
      </div>
      <aside
        aria-hidden
        data-testid="auth-panel"
        className="relative hidden overflow-hidden rounded-xl lg:m-6 lg:block"
      >
        <ImagePlaceholder name={tHome("brand")} className="absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 bg-primary p-8 text-primary-foreground">
          <span data-testid="auth-accent" className="mb-4 block h-0.5 w-14 bg-gold" />
          <p className="font-display text-3xl">{t("panelTitle")}</p>
          <p className="mt-2 text-sm">{t("panelText")}</p>
        </div>
      </aside>
    </main>
  );
}

export function Field({
  label,
  error,
  hint,
  ...props
}: React.ComponentProps<"input"> & { label: string; error?: FieldError | null; hint?: string }) {
  const id = useId();
  const t = useTranslations("auth.validation");
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...props}
      />
      {error ? (
        <p id={`${id}-err`} className="text-sm text-destructive">
          {t(error)}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Localised API error (CLAUDE.md rule 8: never the API message). */
export function FormAlert({ error }: { error: unknown }) {
  const t = useTranslations("errors");
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-card p-3 text-sm text-destructive">
      {apiErrorMessage(t as unknown as Parameters<typeof apiErrorMessage>[0], error)}
    </p>
  );
}

export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="rounded-md border border-success/40 bg-card p-3 text-sm text-success-foreground">
      {children}
    </p>
  );
}
