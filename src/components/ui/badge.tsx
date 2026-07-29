import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-gradient-brand text-white",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        // Pastel, matching success/warning below. A badge reports a state; the
        // solid --destructive red is reserved for buttons that *do* something
        // destructive, where the weight is a warning rather than a label.
        destructive: "border-transparent bg-rose-100 text-rose-800",
        outline: "border-m-outline text-foreground",
        muted: "border-transparent bg-m-surface-container text-m-on-surface-variant",
        success: "border-transparent bg-emerald-100 text-emerald-800",
        warning: "border-transparent bg-amber-100 text-amber-800",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
