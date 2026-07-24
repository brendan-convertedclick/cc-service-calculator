// src/components/briefs/DeliveryFilter.tsx
//
// Second, visually-separate filter loop for the Briefs page: the ClickUp
// delivery status of briefed work (Backlog / In Progress / Completed). Kept
// apart from the Conductor pipeline strip (StatusPipeline) so the two loops —
// "our process" vs "the task's actual ClickUp status" — read as distinct.

import {
  Pill,
  EXECUTION_LABEL,
  type ExecutionBucket,
  type PipelineSelection,
} from "@/components/briefs/StatusPipeline";

const BUCKETS: ExecutionBucket[] = ["backlog", "in_progress", "completed"];

interface DeliveryFilterProps {
  counts: Record<ExecutionBucket, number>;
  active: PipelineSelection;
  onSelect: (s: PipelineSelection) => void;
}

export function DeliveryFilter({ counts, active, onSelect }: DeliveryFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-label-small uppercase tracking-wide text-m-on-surface-variant">
        Delivery · ClickUp
      </span>
      {BUCKETS.map((b) => (
        <Pill
          key={b}
          label={EXECUTION_LABEL[b]}
          count={counts[b]}
          active={active === b}
          tone="secondary"
          onClick={() => onSelect(active === b ? "all" : b)}
        />
      ))}
    </div>
  );
}
