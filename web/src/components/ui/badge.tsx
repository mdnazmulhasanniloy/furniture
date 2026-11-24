import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Badge colours follow design-system.md section 4. Every variant names its fill and its text
 * token explicitly: src/test/ui-02-aa-contrast.test.ts reads these class strings and checks
 * the real token values for 4.5:1.
 */
export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        new: "bg-primary text-primary-foreground",
        preowned: "bg-secondary text-secondary-foreground",
        featured: "bg-gold text-gold-foreground",
        soldOut: "bg-muted text-muted-foreground",
        warning: "bg-warning/15 text-warning-foreground",
        success: "bg-success/15 text-success-foreground",
        destructive: "bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { variant: "new" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
