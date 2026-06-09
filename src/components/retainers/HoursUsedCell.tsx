import { cn } from "@/lib/utils";
import type { RetainerBurnRow } from "@/types/pulse";

const barColor: Record<RetainerBurnRow["rag"], string> = {
  green: "bg-green-500",
  amber: "bg-amber-400",
  red: "bg-m-error",
};

// Current-month hours consumed vs target with a thin RAG burn bar.
// `burn` is null (or flagged needsSetup) for retainers with no target → renders "—".
export function HoursUsedCell({ burn }: { burn: RetainerBurnRow | null }) {
  if (!burn || burn.needsSetup) {
    return (
      <div className="min-w-[7rem]">
        <span className="text-body-medium text-m-on-surface-variant">—</span>
      </div>
    );
  }
  return (
    <div className="min-w-[7rem]">
      <div className="mb-1 text-body-medium tabular-nums text-m-on-surface">
        {burn.hoursUsed} / {burn.hoursTarget}h
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-m-surface-container-high">
        <div
          role="progressbar"
          aria-valuenow={burn.burnPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${burn.hoursUsed} of ${burn.hoursTarget} hours used`}
          className={cn("h-full rounded-full transition-all", barColor[burn.rag])}
          style={{ width: `${Math.min(burn.burnPct, 100)}%` }}
        />
      </div>
    </div>
  );
}
