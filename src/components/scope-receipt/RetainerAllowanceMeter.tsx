import { cn } from "@/lib/utils";

export interface RetainerAllowanceMeterProps {
  /** Allowance currently used this month (occurrences). */
  used: number;
  /** Total monthly allowance. null/undefined or 0 → no retainer allowance. */
  allowance: number | null | undefined;
  /** Occurrences this quote would add on top of `used`. */
  quoteAdds: number;
  /** Service label this meter tracks, e.g. "Landing pages". */
  label?: string;
  className?: string;
}

// RAG thresholds on the post-quote projected fill: <50% green, <90% amber, red.
function rag(projectedPct: number): "green" | "amber" | "red" {
  if (projectedPct < 50) return "green";
  if (projectedPct < 90) return "amber";
  return "red";
}

const USED_COLOR: Record<"green" | "amber" | "red", string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-400",
  red: "bg-m-error",
};

const GHOST_COLOR: Record<"green" | "amber" | "red", string> = {
  // Lighter "this would add" overlay segment per RAG tone.
  green: "bg-emerald-300/70",
  amber: "bg-amber-300/80",
  red: "bg-m-error/40",
};

/**
 * Retainer allowance meter for the Scope Receipt footer. Extends the Retainer
 * Burn bar with a lighter ghost "this quote adds" segment so the operator sees
 * how the quote pushes the client toward (or past) their monthly allowance.
 *
 * Degrades gracefully: when the client has no retainer allowance for the
 * tracked service the bar collapses to a dashed empty rail with a "no retainer
 * allowance" caption (the parent typically hides it entirely in that case).
 */
export function RetainerAllowanceMeter({
  used,
  allowance,
  quoteAdds,
  label,
  className,
}: RetainerAllowanceMeterProps) {
  const hasAllowance = typeof allowance === "number" && allowance > 0;

  if (!hasAllowance) {
    return (
      <div className={cn("space-y-1", className)}>
        <div className="flex items-baseline justify-between">
          <span className="text-label-small font-medium text-m-on-surface">
            {label ?? "Retainer allowance"}
          </span>
          <span className="text-label-small text-m-on-surface-variant">
            no retainer allowance
          </span>
        </div>
        <div className="h-2 w-full rounded-full border border-dashed border-m-outline-variant" />
      </div>
    );
  }

  const total = allowance as number;
  const usedClamped = Math.max(0, used);
  const projected = usedClamped + Math.max(0, quoteAdds);
  const projectedPct = (projected / total) * 100;
  const tone = rag(projectedPct);

  // Widths as a share of the full bar, capped so an overrun still renders.
  const usedPct = Math.min((usedClamped / total) * 100, 100);
  const ghostPct = Math.min((Math.max(0, quoteAdds) / total) * 100, 100 - usedPct);
  const overrun = projected > total;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline justify-between">
        <span className="text-label-small font-medium text-m-on-surface">
          {label ?? "Retainer allowance"}
        </span>
        <span
          className={cn(
            "text-label-small font-semibold tabular-nums",
            tone === "green"
              ? "text-m-on-surface-variant"
              : tone === "amber"
                ? "text-amber-700"
                : "text-m-error",
          )}
        >
          {usedClamped}
          {quoteAdds > 0 && (
            <span className="font-normal"> +{quoteAdds}</span>
          )}{" "}
          / {total}
        </span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-m-surface-container-high">
        <div
          className={cn("h-full transition-all", USED_COLOR[tone])}
          style={{ width: `${usedPct}%` }}
          aria-hidden="true"
        />
        {ghostPct > 0 && (
          <div
            className={cn("h-full transition-all", GHOST_COLOR[tone])}
            style={{ width: `${ghostPct}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {overrun && (
        <p className="text-label-small font-medium text-m-error">
          This quote exceeds the monthly allowance.
        </p>
      )}
    </div>
  );
}
