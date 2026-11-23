"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/api/errors";
import type { FieldError } from "@/lib/auth/validation";

/** Split layout (W-06): form on the start side, decorative panel on the end side (>= lg). */
export function AuthShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const t = useTranslations("auth");
  return (
    <main className="mx-auto grid min-h-[70vh] w-full max-w-6xl lg:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">{children}</div>
      </div>
      <aside
        aria-hidden
        className="hidden flex-col justify-end gap-2 rounded-xl bg-primary p-10 text-primary-foreground lg:m-6 lg:flex"
      >
        <p className="font-display text-3xl">{t("panelTitle")}</p>
        <p className="text-sm opacity-90">{t("panelText")}</p>
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
    <p role="status" className="rounded-md border border-success/40 bg-card p-3 text-sm text-success">
      {children}
    </p>
  );
}
