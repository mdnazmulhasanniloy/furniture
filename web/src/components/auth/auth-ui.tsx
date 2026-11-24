"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { Arch } from "@/components/arch";
import { ImagePlaceholder } from "@/components/brand";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/api/errors";
import type { FieldError } from "@/lib/auth/validation";

/**
 * Auth layout (W-06, ADR-015): the form on the start side; from lg a sand panel on the end side holds the
 * third and last use of the arch (4:5, gold outline) with a plain caption under it. Below lg the form stands
 * alone under a small arch. The panel is decorative (aria-hidden). Mirrors in RTL through grid order.
 * The arch holds the flat sand placeholder until real photos exist (B-022).
 */
export function AuthShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const t = useTranslations("auth");
  const tHome = useTranslations("home");
  return (
    <main className="grid min-h-[70vh] w-full lg:grid-cols-2" data-testid="auth-shell">
      <div className="flex items-center justify-center px-4 py-10 sm:px-8 lg:py-16">
        <div className="w-full max-w-md">
          <div aria-hidden data-testid="auth-arch-small" className="mb-6 lg:hidden">
            <Arch ratio="3/4" className="w-14" />
          </div>
          {children}
        </div>
      </div>
      <aside
        aria-hidden
        data-testid="auth-panel"
        className="hidden flex-col items-center justify-center gap-10 bg-muted px-10 py-16 lg:flex"
      >
        <div className="w-full max-w-sm">
          <Arch ratio="4/5" outline>
            <ImagePlaceholder name={tHome("brand")} className="bg-background" />
          </Arch>
        </div>
        <div className="max-w-sm text-center">
          <p className="text-2xl font-semibold">{t("panelTitle")}</p>
          <p className="measure mt-2 text-muted-foreground">{t("panelText")}</p>
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
    <p role="alert" className="border-s-[3px] border-destructive bg-muted p-3 text-sm text-destructive">
      {apiErrorMessage(t as unknown as Parameters<typeof apiErrorMessage>[0], error)}
    </p>
  );
}

export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="border-s-[3px] border-success bg-muted p-3 text-sm text-success-foreground">
      {children}
    </p>
  );
}
