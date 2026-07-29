import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtPtH } from "@/lib/sprint-points";
import { consumedPct, useTaskContext } from "@/hooks/useTaskContext";
import type { ExtensionRequestRow } from "@/types/extension-requests";

/** One loaded row. The page fetches a single shape; the rail uses part of it
 *  and the detail pane uses the rest. */
export type RailRow = ExtensionRequestRow & {
  client: { id: string; name: string } | null;
  requester: { id: string; full_name: string; email: string | null } | null;
  admin_approver: { id: string; full_name: string } | null;
};

export type RailGroup = {
  key: string;
  label: string;
  rows: RailRow[];
  /** Groups the owner can't act on are shown but read as context, not work. */
  actionable: boolean;
};

/**
 * The queue side of the escalations page: every request grouped by who is
 * holding it, so "does this need me?" is answered by which group a row is in
 * rather than by reading the row.
 */
export function EscalationRail({
  groups,
  selectedId,
  onSelect,
}: {
  groups: RailGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Escalation queue" className="flex h-full flex-col gap-1 py-3">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h2 className="flex items-baseline justify-between gap-2 px-4 pb-1.5 pt-3">
            <span className="text-label-small font-semibold uppercase tracking-wide text-m-on-surface-variant">
              {group.label}
            </span>
            <span className="font-mono text-label-small tabular-nums text-m-on-surface-variant">
              {group.rows.length}
            </span>
          </h2>
          {group.rows.length === 0 ? (
            <p className="px-4 pb-1 text-label-small text-m-on-surface-variant/70">None</p>
          ) : (
            <ul>
              {group.rows.map((row) => (
                <li key={row.id}>
                  <RailItem
                    row={row}
                    muted={!group.actionable}
                    selected={row.id === selectedId}
                    onSelect={onSelect}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </nav>
  );
}

function RailItem({
  row,
  selected,
  muted,
  onSelect,
}: {
  row: RailRow;
  selected: boolean;
  muted: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full border-l-2 px-4 py-2.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selected
          ? "border-l-m-primary bg-m-surface-container"
          : "border-l-transparent hover:bg-m-surface-container-low",
      )}
    >
      <span
        className={cn(
          "line-clamp-2 block text-body-small font-medium",
          muted ? "text-m-on-surface-variant" : "text-m-on-surface",
        )}
      >
        {row.parent_task_name}
      </span>
      <span className="mt-0.5 block truncate text-label-small text-m-on-surface-variant">
        {row.client?.name ?? "—"} · {row.requester?.full_name ?? "—"}
      </span>
      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-label-small tabular-nums text-m-on-surface-variant">
          {askSummary(row)}
        </span>
        <ConsumedBadge taskId={row.parent_clickup_task_id} />
      </span>
    </button>
  );
}

/**
 * Consumption is the number that decides most of these, so it earns a place in
 * the rail. It arrives from ClickUp a moment after the row does; until then the
 * badge is simply absent rather than a spinner in a 20px slot.
 */
function ConsumedBadge({ taskId }: { taskId: string }) {
  const { data } = useTaskContext(taskId);
  const pct = consumedPct(data);
  if (pct === null) return null;
  return (
    <Badge
      variant={pct > 100 ? "destructive" : pct > 75 ? "warning" : "muted"}
      className="font-mono tabular-nums"
    >
      {`${pct}%`}
    </Badge>
  );
}

/** What is being asked for, in the fewest characters that stay unambiguous. */
export function askSummary(row: ExtensionRequestRow): string {
  const parts: string[] = [];
  if (row.extra_points !== null) parts.push(`+${fmtPtH(row.extra_points)}`);
  if (row.requested_due_date !== null) parts.push("date push");
  return parts.join(" · ") || "—";
}
