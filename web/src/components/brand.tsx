import { cn } from "@/lib/utils";

/**
 * Text wordmark (owner 2026-11-24, B-006 still open): "Furnixa" / "فرنيكسا" in the heading font with a
 * thin gold underline. A logo set in Site Settings replaces it where one is available.
 * `name` comes from messages (`home.brand`) so it is localized.
 */
export function Wordmark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      data-testid="wordmark"
      className={cn(
        "inline-block font-display font-semibold tracking-tight",
        "border-b-2 border-gold pb-0.5",
        className,
      )}
    >
      {name}
    </span>
  );
}

/** Missing-image placeholder (B-022): emerald pattern with the wordmark. Fills its (sized) parent. */
export function ImagePlaceholder({ name, className }: { name: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={name}
      data-testid="image-placeholder"
      className={cn(
        "pattern-emerald flex size-full items-center justify-center text-primary-foreground",
        className,
      )}
    >
      <Wordmark name={name} className="text-xl" />
    </div>
  );
}
