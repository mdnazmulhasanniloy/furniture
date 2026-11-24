import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Badge colours follow design-system.md section 4. Every variant names its fill and its text
 * token explicitly: src/test/ui-02-aa-contrast.test.ts reads these class strings and checks
 * the real token values for 4.5:1.
 */
export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-[0.8125rem] font-medium leading-5 whitespace-nowrap",
  {
    variants: {
      variant: {
        new: "bg-primary text-primary-foreground",
        preowned: "bg-secondary text-secondary-foreground",
        featured: "border border-primary bg-card text-primary",
        soldOut: "border border-foreground bg-card text-foreground",
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
