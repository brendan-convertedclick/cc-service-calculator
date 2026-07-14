import { cn } from "@/lib/utils";
import { Money } from "@/components/ui/money";
import {
  DISPOSITION_ORDER,
  type ScopeReceiptModel,
} from "@/lib/scope-receipt";
import type { Disposition } from "@/types/sow-placements";

// Segment fill colours. Kept off the violet m-primary-container (reserved for
// the legacy "included" chip on the map) — emerald / amber / neutral grey.
const SEGMENT_CLASS: Record<Disposition, string> = {
  in_agreed_scope: "bg-emerald-500",
  new_billable: "bg-amber-400",
  out_of_scope: "bg-m-outline-variant",
};

export interface CoverageBarProps {
  model: ScopeReceiptModel;
  /** Client view hides the out-of-scope segment + count. */
  clientMode?: boolean;
}

/**
 * Thin stacked bar summarising coverage. Segment widths are driven by per-bucket
 * line COUNT (not money) so the visual answers "how much of this request is
 * covered". Inline caption spells out the same split in words.
 */
export function CoverageBar({ model, clientMode = false }: CoverageBarProps) {
  const dispositions = clientMode
    ? DISPOSITION_ORDER.filter((d) => d !== "out_of_scope")
    : DISPOSITION_ORDER;

  const total = dispositions.reduce((s, d) => s + model.counts[d], 0);

  return (
    <div className="space-y-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-m-surface-container-high">
        {total === 0 ? null : (
          dispositions.map((d) => {
            const count = model.counts[d];
            if (count === 0) return null;
            return (
              <div
                key={d}
                className={cn("h-full transition-all", SEGMENT_CLASS[d])}
                style={{ width: `${(count / total) * 100}%` }}
                aria-hidden="true"
              />
            );
          })
        )}
      </div>
      <p className="text-label-small text-m-on-surface-variant tabular-nums">
        <span className="font-medium text-emerald-700">
          {model.counts.in_agreed_scope} included
        </span>
        {" · "}
        <span className="font-medium text-amber-700">
          {model.counts.new_billable} new (<Money cents={model.billableTotalCents} />)
        </span>
        {!clientMode && (
          <>
            {" · "}
            <span className="font-medium text-m-on-surface-variant">
              {model.counts.out_of_scope} out
            </span>
          </>
        )}
      </p>
    </div>
  );
}
