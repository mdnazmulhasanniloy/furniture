"use client";

import { useLocale } from "next-intl";
import { Toaster } from "sonner";

/**
 * App toasts (sonner, approved by the owner 2026-11-24): add-to-cart and remove-with-undo.
 * Styled with design tokens only; the layout direction follows the locale so actions sit on the
 * correct side in RTL. Notification toasts keep their own toaster (NOTIF-02).
 */
export function AppToaster() {
  const dir = useLocale() === "ar" ? "rtl" : "ltr";
  return (
    <Toaster
      dir={dir}
      position="bottom-center"
      duration={5000}
      closeButton
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[22rem] max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm text-card-foreground shadow-float",
          title: "font-medium",
          actionButton:
            "ms-auto rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          closeButton:
            "rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        },
      }}
    />
  );
}
