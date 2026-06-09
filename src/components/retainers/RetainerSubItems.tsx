import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRetainerSubItems } from "@/hooks/useRetainerSubItems";

const dayMonth = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
});

function formatPeriod(startIso: string, endIso: string): string {
  return `${dayMonth.format(new Date(startIso))} – ${dayMonth.format(new Date(endIso))}`;
}

function formatHours(h: number | null): string {
  if (h == null) return "—";
  return `${Math.round(h * 100) / 100}h`;
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Expanded-row panel under a retainer: every provisioned ClickUp task with
// estimate vs hours used and its status at last sync.
export function RetainerSubItems({ projectId }: { projectId: string }) {
  const { data: items, isLoading, error } = useRetainerSubItems(projectId);

  if (isLoading) {
    return (
      <div className="px-12 py-3 text-body-medium text-m-on-surface-variant">
        Loading tasks…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-12 py-3 text-body-medium text-m-error">
        Failed to load tasks for this retainer.
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="px-12 py-3 text-body-medium text-m-on-surface-variant">
        No tasks provisioned yet for this retainer.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-12">Task</TableHead>
          <TableHead>Assignee</TableHead>
          <TableHead>Period</TableHead>
          <TableHead className="text-right">Estimated</TableHead>
          <TableHead className="text-right">Used</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.taskId} className="hover:bg-transparent">
            <TableCell className="pl-12 text-body-medium text-m-on-surface">
              {item.serviceName}
            </TableCell>
            <TableCell className="text-body-medium text-m-on-surface-variant">
              {item.assigneeName ?? "—"}
            </TableCell>
            <TableCell className="text-body-medium tabular-nums text-m-on-surface-variant">
              {formatPeriod(item.periodStart, item.periodEnd)}
            </TableCell>
            <TableCell className="text-right text-body-medium tabular-nums text-m-on-surface">
              {formatHours(item.estimatedHours)}
            </TableCell>
            <TableCell className="text-right text-body-medium tabular-nums text-m-on-surface">
              {formatHours(item.usedHours)}
            </TableCell>
            <TableCell>
              {item.status == null ? (
                <Badge variant="muted">Not synced</Badge>
              ) : item.isDone ? (
                <Badge>{statusLabel(item.status)}</Badge>
              ) : (
                <Badge variant="muted">{statusLabel(item.status)}</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
