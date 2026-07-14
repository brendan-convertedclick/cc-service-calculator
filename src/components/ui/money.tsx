import { formatZar } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface MoneyProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Amount in integer cents (the canonical DB representation). */
  cents: number;
}

/**
 * Renders a ZAR amount in the mono face with tabular figures, per the
 * Numbers-Are-Mono rule in DESIGN.md — currency reads as exact and columns of
 * figures align. Use this anywhere money is shown instead of inlining
 * `formatZar(...)`, so every amount across the app is typeset consistently.
 */
export function Money({ cents, className, ...props }: MoneyProps) {
  return (
    <span className={cn("font-mono tabular-nums", className)} {...props}>
      {formatZar(cents)}
    </span>
  );
}
