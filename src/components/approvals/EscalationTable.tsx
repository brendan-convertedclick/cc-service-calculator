import { Fragment } from "react";
import { Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { fmtPtH } from "@/lib/sprint-points";
import { briefDate } from "@/components/BriefList";
import { consumedPct, useTaskContext } from "@/hooks/useTaskContext";
import {
  askedForPoints,
  holderOf,
  HOLDER_LABEL,
  type EscalationRow,
} from "@/types/extension-requests";

export type ClientGroup = { clientId: string; clientName: string; rows: EscalationRow[] };

/**
 * Every escalation, grouped under the client footing the bill.
 *
 * Who a request is waiting on is a badge here rather than the grouping, because
 * an owner reads this page by client — three overruns on one retainer in a
 * month is the pattern worth seeing, and that pattern is invisible when the
 * same rows are split across four status buckets.
 */
export function EscalationTable({
  groups,
  selectedId,
  onSelect,
}: {
  groups: ClientGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    // Five columns don't compress below ~46rem without shredding the task
    // name into one word per line. Narrower than that, the container scrolls.
    <Table className="min-w-[46rem]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-px">Raised</TableHead>
          <TableHead>Task</TableHead>
          <TableHead>Asking for</TableHead>
          <TableHead>Consumed</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <Fragment key={group.clientId}>
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={5}
                className="border-b border-m-outline-variant bg-m-surface-container-low py-2"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-title-small font-semibold text-m-on-surface">
                    {group.clientName}
                  </span>
                  <span className="text-label-small text-m-on-surface-variant">
                    {group.rows.length} escalation{group.rows.length !== 1 ? "s" : ""}
                  </span>
                </div>
              </TableCell>
            </TableRow>
            {group.rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                selected={row.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

function Row({
  row,
  selected,
  onSelect,
}: {
  row: EscalationRow;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const holder = holderOf(row);
  const raised = briefDate(row.created_at);
  return (
    <TableRow
      onClick={() => onSelect(row.id)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "cursor-pointer [&>td]:py-2",
        selected && "bg-m-surface-container",
        // Decided rows stay legible but stop competing with live work.
        holder === "done" && "text-m-on-surface-variant",
      )}
    >
      <TableCell className="w-px whitespace-nowrap pr-2">
        <time
          title={raised.title}
          className="flex w-20 shrink-0 items-center gap-1.5 font-mono text-label-small tabular-nums text-m-on-surface-variant"
        >
          <Calendar className="h-3.5 w-3.5 shrink-0 text-m-outline" aria-hidden />
          {raised.label}
        </time>
      </TableCell>
      <TableCell className="max-w-[440px]">
        <div className="whitespace-normal break-words text-body-small text-m-on-surface">
          {row.parent_task_name}
        </div>
        <div className="text-label-small text-m-on-surface-variant">
          {row.requester?.full_name ?? "—"}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-label-small tabular-nums text-m-on-surface-variant">
        {askSummary(row)}
      </TableCell>
      <TableCell>
        <ConsumedBadge taskId={row.parent_clickup_task_id} />
      </TableCell>
      <TableCell>
        <Badge
          variant={holder === "owner" ? "default" : holder === "done" ? "muted" : "warning"}
          className="whitespace-nowrap"
        >
          {HOLDER_LABEL[holder]}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

/**
 * How much of the task's budget is already gone — the number that decides most
 * of these. It arrives from ClickUp a moment after the row does; until then the
 * cell is empty rather than a spinner in a 20px slot.
 */
function ConsumedBadge({ taskId }: { taskId: string }) {
  const { data } = useTaskContext(taskId);
  const pct = consumedPct(data);
  if (pct === null) return <span className="text-label-small text-m-on-surface-variant">—</span>;
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
export function askSummary(row: EscalationRow): string {
  const parts: string[] = [];
  if (askedForPoints(row)) parts.push(`+${fmtPtH(row.extra_points)}`);
  if (row.requested_due_date !== null) parts.push("date push");
  return parts.join(" · ") || "—";
}
