import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, Plus, Trash2, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRetainers, useDeleteRetainer } from "@/hooks/useRetainers";
import { usePulseRetainerBurn } from "@/hooks/usePulseRetainerBurn";
import { useSyncActuals } from "@/hooks/useSyncActuals";
import { HoursUsedCell } from "@/components/retainers/HoursUsedCell";
import { RetainerSubItems } from "@/components/retainers/RetainerSubItems";
import { formatZar, cn } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/project-status";

function statusLabel(status: string): string {
  return (STATUS_LABEL as Record<string, string>)[status] ?? status;
}

export function RetainersList() {
  const navigate = useNavigate();
  const { data: retainers = [] } = useRetainers();
  const deleteRetainer = useDeleteRetainer();
  // includeCompleted: a retainer that has completed must still show its
  // consumed hours here (Pulse keeps the default in-progress-only view).
  // Month defaults to the current month.
  const burnRows = usePulseRetainerBurn(undefined, { includeCompleted: true });
  const sync = useSyncActuals();
  const burnByProject = useMemo(
    () => new Map(burnRows.map((b) => [b.projectId, b])),
    [burnRows],
  );
  // Group by client (alphabetical), then by retainer name within each client.
  const sortedRetainers = useMemo(
    () =>
      [...retainers].sort(
        (a, b) =>
          (a.client_name ?? "").localeCompare(b.client_name ?? "") ||
          (a.name ?? "").localeCompare(b.name ?? ""),
      ),
    [retainers],
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function toggleExpanded(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleSync(projectId?: string, label?: string) {
    sync.mutate(projectId, {
      onSuccess: () => toast.success(label ? `Synced ${label}` : "Synced all retainers"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Sync failed"),
    });
  }

  return (
    <div className="max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-headline-medium">Retainers</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => handleSync(undefined)}
            disabled={sync.isPending}
          >
            <RefreshCw
              className={cn("h-4 w-4", sync.isPending && sync.variables === undefined && "animate-spin")}
            />
            Sync all
          </Button>
          <Button onClick={() => navigate("/retainers/new")}>
            <Plus className="h-4 w-4" />
            New retainer
          </Button>
        </div>
      </div>

      {retainers.length === 0 ? (
        <div className="text-body-medium text-m-on-surface-variant">
          No retainers yet. Create one with the “New retainer” button to set up monthly hours,
          a fee, and recurring services.
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-px" />
                  <TableHead>Client</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Monthly fee</TableHead>
                  <TableHead className="text-right">Hours target</TableHead>
                  <TableHead>Hours used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRetainers.map((r) => (
                  <Fragment key={r.id}>
                  <TableRow
                    onClick={() => navigate(`/projects/${r.id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell className="w-px pr-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${expanded[r.id] ? "Hide" : "Show"} tasks for ${r.name}`}
                        aria-expanded={!!expanded[r.id]}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(r.id);
                        }}
                      >
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 transition-transform",
                            expanded[r.id] && "rotate-90",
                          )}
                        />
                      </Button>
                    </TableCell>
                    <TableCell className="text-body-medium text-m-on-surface">
                      {r.client_name}
                    </TableCell>
                    <TableCell className="text-body-medium text-m-on-surface">
                      {r.name}
                    </TableCell>
                    <TableCell className="text-right text-body-medium tabular-nums text-m-on-surface">
                      {r.retainer_monthly_fee_cents != null
                        ? formatZar(r.retainer_monthly_fee_cents)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-body-medium tabular-nums text-m-on-surface">
                      {r.retainer_hours_target ?? "—"}
                    </TableCell>
                    <TableCell>
                      <HoursUsedCell burn={burnByProject.get(r.id) ?? null} />
                    </TableCell>
                    <TableCell>
                      <Badge className="whitespace-nowrap">{statusLabel(r.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={sync.isPending}
                        aria-label={`Sync ${r.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSync(r.id, r.name);
                        }}
                      >
                        <RefreshCw
                          className={cn("h-4 w-4", sync.isPending && sync.variables === r.id && "animate-spin")}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={deleteRetainer.isPending}
                        aria-label={`Delete retainer ${r.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            confirm(
                              `Delete "${r.name}" for ${r.client_name}? This removes the retainer and its recurring services. The ClickUp list is left untouched.`,
                            )
                          ) {
                            deleteRetainer.mutate(r.id, {
                              onSuccess: () => toast.success("Retainer deleted"),
                              onError: (err) =>
                                toast.error(
                                  err instanceof Error ? err.message : "Failed to delete retainer",
                                ),
                            });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expanded[r.id] && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={8} className="bg-m-surface-container-low p-0">
                        <RetainerSubItems projectId={r.id} />
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
