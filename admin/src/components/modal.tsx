import { useEffect, type ReactNode } from "react";

/** Hand-written dialog (no Radix): Escape closes; no focus trap yet (T-063 assumption 7). */
export function Modal({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-foreground/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-md"
      >
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  error,
  children,
  htmlFor,
  hint,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  htmlFor: string;
  hint?: string;
}) {
  return (
    <div className="mt-3">
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
