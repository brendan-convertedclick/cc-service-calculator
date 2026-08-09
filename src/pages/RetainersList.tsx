import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, Plus, Trash2, RefreshCw, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterGroup, FilterOption } from "@/components/filters/FilterRail";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRetainers, useDeleteRetainer } from "@/hooks/useRetainers";
import { usePulseRetainerBurn, currentMonthKey } from "@/hooks/usePulseRetainerBurn";
import { useSyncActuals } from "@/hooks/useSyncActuals";
import { HoursUsedCell } from "@/components/retainers/HoursUsedCell";
import { RetainerSubItems } from "@/components/retainers/RetainerSubItems";
import { formatZar, cn } from "@/lib/utils";
import { STATUS_LABEL } from "@/lib/project-status";

// The stored project_status enum uses "completed"/"in_progress"; DerivedStatus
// uses "complete". Normalise both so the badge never shows a raw lowercase token.
const RAW_STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress",
  completed: "Complete",
  cancelled: "Cancelled",
  archived: "Archived",
  backlog: "Backlog",
};

function statusLabel(status: string): string {
  return (
    RAW_STATUS_LABEL[status] ??
    (STATUS_LABEL as Record<string, string>)[status] ??
    status
  );
}

// Active retainers pop (success), finished/inactive ones recede (muted) — same
// convention as ServicesList (active → success). Reserved gradient stays off status.
function statusVariant(status: string): "success" | "muted" | "outline" {
  if (status === "in_progress" || status === "active") return "success";
  if (status === "backlog" || status === "to do") return "outline";
  return "muted"; // complete, completed, cancelled, archived, closed, done
}

// Client is the group header; every row is a retainer — so strip the redundant
// "{Client} … Retainer" boilerplate from the name and show only the differentiator.
function displayRetainerName(name: string, clientName: string | null): string {
  let n = (name ?? "").trim();
  const client = (clientName ?? "").trim();
  if (client && n.toLowerCase().startsWith(client.toLowerCase())) {
    n = n.slice(client.length).trim();
  }
  n = n.replace(/\s*retainer\s*$/i, "").trim();
  return n || name; // never render empty
}

export function RetainersList() {
  const navigate = useNavigate();
  const { data: retainers = [] } = useRetainers();
  const deleteRetainer = useDeleteRetainer();
  // includeCompleted: a retainer that has completed must still show its
  // consumed hours here (Pulse keeps the default in-progress-only view).
  const [month, setMonth] = useState(() => currentMonthKey());
  const burnRows = usePulseRetainerBurn(month, { includeCompleted: true });
  const sync = useSyncActuals();
  const burnByProject = useMemo(
    () => new Map(burnRows.map((b) => [b.projectId, b])),
    [burnRows],
  );

  const [search, setSearch] = useState("");
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const q = search.trim().toLowerCase();

  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of retainers) set.add(r.client_name ?? "—");
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [retainers]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of retainers) set.add(r.status);
    return [...set].sort();
  }, [retainers]);

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

  const filteredRetainers = useMemo(
    () =>
      sortedRetainers.filter((r) => {
        const clientName = r.client_name ?? "—";
        if (selectedClients.size > 0 && !selectedClients.has(clientName)) return false;
        if (selectedStatuses.size > 0 && !selectedStatuses.has(r.status)) return false;
        if (q) {
          const hay = `${r.name ?? ""} ${r.client_name ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [sortedRetainers, selectedClients, selectedStatuses, q],
  );

  // Collapse the repeated Client column into real per-client groups, each with a
  // count + monthly-fee total so the operator doesn't eyeball-sum the column.
  const clientGroups = useMemo(() => {
    const map = new Map<string, typeof filteredRetainers>();
    for (const r of filteredRetainers) {
      const key = r.client_name ?? "—";
      (map.get(key) ?? map.set(key, []).get(key)!).push(r);
    }
    return [...map.entries()].map(([clientName, rows]) => ({
      clientName,
      rows,
      totalFeeCents: rows.reduce(
        (sum, r) => sum + (r.retainer_monthly_fee_cents ?? 0),
        0,
      ),
    }));
  }, [filteredRetainers]);

  const hasFilters = selectedClients.size > 0 || selectedStatuses.size > 0;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function toggleExpanded(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleClient(name: string) {
    setSelectedClients((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleStatus(status: string) {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  function handleSync(projectId?: string, label?: string) {
    sync.mutate(projectId, {
      onSuccess: () => toast.success(label ? `Synced ${label}` : "Synced all retainers"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Sync failed"),
    });
  }

  return (
    <div className="flex h-full">
      {/* ── Left filter rail: search on top → divider → filter groups below ── */}
      <aside className="w-56 shrink-0 space-y-5 overflow-y-auto border-r border-m-outline-variant p-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
          <Input
            aria-label="Search retainers"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8"
          />
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-label-large text-m-on-surface">Filters</h3>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSelectedClients(new Set());
                setSelectedStatuses(new Set());
              }}
              className="text-label-small text-m-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        {clientOptions.length > 0 && (
          <FilterGroup label="Client">
            {clientOptions.map((name) => (
              <FilterOption
                key={name}
                label={name}
                active={selectedClients.has(name)}
                onToggle={() => toggleClient(name)}
              />
            ))}
          </FilterGroup>
        )}

        {statusOptions.length > 0 && (
          <FilterGroup label="Status">
            {statusOptions.map((status) => (
              <FilterOption
                key={status}
                label={statusLabel(status)}
                active={selectedStatuses.has(status)}
                onToggle={() => toggleStatus(status)}
              />
            ))}
          </FilterGroup>
        )}
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-headline-medium">Retainers</h1>
          <div className="flex items-center gap-2">
            <input
              type="month"
              aria-label="Select month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="rounded-md border border-m-outline-variant bg-transparent px-3 py-1.5 text-body-small text-m-on-surface"
            />
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
        ) : clientGroups.length > 0 ? (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-px" />
                    <TableHead>Name</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Monthly fee</TableHead>
                    <TableHead className="whitespace-nowrap">Hours used</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientGroups.map((group) => (
                    <Fragment key={group.clientName}>
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="border-b border-m-outline-variant bg-m-surface-container-low py-2">
                          <div className="flex items-baseline justify-between gap-4">
                            <span className="text-title-small font-semibold text-m-on-surface">
                              {group.clientName}
                            </span>
                            <span className="text-label-small text-m-on-surface-variant">
                              {group.rows.length} retainer{group.rows.length !== 1 ? "s" : ""}
                              {group.totalFeeCents > 0 && (
                                <>
                                  {" · "}
                                  <span className="font-mono tabular-nums text-m-on-surface">
                                    {formatZar(group.totalFeeCents)}
                                  </span>
                                  /mo
                                </>
                              )}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                      {group.rows.map((r) => (
                        <Fragment key={r.id}>
                          <TableRow
                            onClick={() => navigate(`/projects/${r.id}`)}
                            className="cursor-pointer [&>td]:py-2"
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
                              {displayRetainerName(r.name, r.client_name)}
                            </TableCell>
                            <TableCell className="text-right text-body-medium font-mono tabular-nums text-m-on-surface">
                              {r.retainer_monthly_fee_cents != null
                                ? formatZar(r.retainer_monthly_fee_cents)
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <HoursUsedCell burn={burnByProject.get(r.id) ?? null} />
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusVariant(r.status)} className="whitespace-nowrap">
                                {statusLabel(r.status)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
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
                              </div>
                            </TableCell>
                          </TableRow>
                          {expanded[r.id] && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={6} className="bg-m-surface-container-low p-0">
                                <RetainerSubItems projectId={r.id} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <div className="text-body-medium text-m-on-surface-variant">
            No retainers match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}
