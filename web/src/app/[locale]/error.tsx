"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/**
 * Route error boundary (CR-011 fix 1): a render error inside any page shows a message and a retry
 * button instead of a blank page. Uses existing copy only (errors.generic, cart.retry).
 */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations();
  return (
    <main data-testid="route-error" className="container-wide band flex min-h-[50vh] flex-col items-start justify-center gap-6">
      <h1 className="text-3xl">{t("errors.generic")}</h1>
      <Button type="button" onClick={reset} className="h-12 px-8">
        {t("cart.retry")}
      </Button>
    </main>
  );
}
