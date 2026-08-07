// Bottom strip — hours by department across this system's top-level steps.
// Sub-steps carry no hours (process_steps_substep_no_hours), so summing
// top-level rows only is already the complete total; no separate filter
// needed. Matches docs/2026-08-05-systems-canvas-visual-spec.html's rollup.
import type { Database } from "@/types/db";

type DeptRow = Database["public"]["Tables"]["departments"]["Row"];

function formatHours(hours: number): string {
  // Strips trailing zeroes (4 -> "4", 4.25 -> "4.25") without reintroducing
  // float noise from summing numeric(6,2) values in JS.
  return Number(hours.toFixed(2)).toString();
}

export function DeptRollup({
  items,
  unassignedCount,
  totalHours,
}: {
  items: { dept: DeptRow; hours: number }[];
  unassignedCount: number;
  totalHours: number;
}) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-4 border-t border-m-outline-variant bg-m-surface-container px-4 py-2.5">
      <span className="text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">
        Rolled up by department
      </span>
      {items.map(({ dept, hours }) => (
        <span key={dept.id} className="flex items-center gap-1.5 text-body-small text-m-on-surface">
          <span
            className="h-2.5 w-2.5 flex-none rounded-sm"
            style={{ background: dept.color ?? "hsl(var(--mcolor-outline-variant))" }}
          />
          {dept.name}
          <span className="font-mono font-semibold">{formatHours(hours)}h</span>
        </span>
      ))}
      {unassignedCount > 0 && (
        <span className="flex items-center gap-1.5 text-body-small text-m-error">
          <span className="h-2.5 w-2.5 flex-none rounded-sm bg-m-error" />
          Unassigned — {unassignedCount} block{unassignedCount === 1 ? "" : "s"}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5 text-body-small font-semibold text-m-on-surface">
        Total <span className="font-mono">{formatHours(totalHours)}h</span>
      </span>
    </div>
  );
}
