// src/components/briefs/StatusPipeline.tsx
//
// Horizontal brief-lifecycle strip: "All" plus one pill per status in
// pipeline order, joined by arrows, each showing its live count and acting
// as a single-select filter. Shared by the Briefs page and the Inbox.

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type BriefStatus } from "@/lib/brief-routing";

/** Lifecycle order shown in the strip. Dead-ends (rejected/spam/archived) stay out. */
export const PIPELINE_STATUSES: BriefStatus[] = [
  "new",
  "needs_info",
  "triaged",
  "scoped",
  "quoted",
  "accepted",
  "briefed",
];

export type PipelineSelection = BriefStatus | "all";

interface StatusPipelineProps {
  counts: Partial<Record<BriefStatus, number>>;
  active: PipelineSelection;
  onSelect: (s: PipelineSelection) => void;
  /** Append an Archived pill after a divider (off the arrow flow — it's a dead-end, not a stage). */
  showArchived?: boolean;
  className?: string;
}

function Pill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const empty = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-label-medium tracking-normal transition-colors",
        active
          ? "border-transparent bg-m-primary text-m-on-primary"
          : empty
            ? "border-m-outline-variant text-m-on-surface-variant/70 hover:bg-m-surface-container"
            : "border-m-outline text-m-on-surface hover:bg-m-surface-container",
      )}
    >
      <span className="whitespace-nowrap">{label}</span>
      <span className={cn("font-semibold tabular-nums", !active && empty && "font-normal")}>
        {count}
      </span>
    </button>
  );
}

export function StatusPipeline({
  counts,
  active,
  onSelect,
  showArchived = false,
  className,
}: StatusPipelineProps) {
  const total = PIPELINE_STATUSES.reduce((s, st) => s + (counts[st] ?? 0), 0);
  return (
    <div
      role="group"
      aria-label="Filter briefs by status"
      className={cn("flex flex-wrap items-center gap-y-2", className)}
    >
      <Pill
        label="All"
        count={total}
        active={active === "all"}
        onClick={() => onSelect("all")}
      />
      <span className="w-2.5 shrink-0" aria-hidden="true" />
      {PIPELINE_STATUSES.map((s, i) => (
        <div key={s} className="flex items-center">
          {i > 0 && (
            <ChevronRight
              className="mx-1 h-3.5 w-3.5 shrink-0 text-m-on-surface-variant"
              aria-hidden="true"
            />
          )}
          <Pill
            label={STATUS_LABEL[s]}
            count={counts[s] ?? 0}
            active={active === s}
            onClick={() => onSelect(active === s ? "all" : s)}
          />
        </div>
      ))}
      {showArchived && (
        <div className="flex items-center">
          <span
            className="mx-2.5 h-4 w-px shrink-0 bg-m-outline-variant"
            aria-hidden="true"
          />
          <Pill
            label={STATUS_LABEL.archived}
            count={counts.archived ?? 0}
            active={active === "archived"}
            onClick={() => onSelect(active === "archived" ? "all" : "archived")}
          />
        </div>
      )}
    </div>
  );
}
