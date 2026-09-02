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
import { currentMonthKey } from "@/hooks/usePulseRetainerBurn";
import { useSyncActuals } from "@/hooks/useSyncActuals";
import { useRetainerAllocation, type AllocationRow } from "@/hooks/useRetainerAllocation";
import { RetainerSubItems } from "@/components/retainers/RetainerSubItems";
import { formatZar, cn, errorMessage, toggleInSet } from "@/lib/utils";
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

function fmtHours(n: number): string {
  return n ? `${Math.round(n * 10) / 10}h` : "—";
}

/** Red in BOTH directions: over-delivery is a margin problem, not a win. */
// Judged against Planned — what the fee buys. It used to be judged against the
// recurring schedule, which is why Kings College read as a red flag: 19.3 of its
// 22.8 planned hours are on a retainer with no recurring tasks at all, so the
// schedule said 2.3h and the colour called a normal month a disaster.
// The three categories Lisa asked for, plus the two shapes that are neither a
// budgeted retainer nor ad hoc and would otherwise have nowhere to go.
const CATEGORY_LABEL: Record<AllocationRow["kind"], string> = {
  retainer: "Retainer",
  adhoc: "Ad hoc",
  internal: "Internal",
  unlinked: "No retainer",
  fixed: "Fixed price",
};

function deliveredTone(delivered: number, basis: number): string {
  if (!basis || !delivered) return "text-m-on-surface-variant";
  const ratio = delivered / basis;
  if (ratio > 1.25) return "text-m-error";
  if (ratio < 0.6) return "text-amber-600";
  return "text-m-tertiary";
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
  const sync = useSyncActuals();

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
  // Sold / Committed / Delivered come from the allocation model, not from
  // project_actuals. project_actuals only ever counted provisioned tasks, which
  // is why this page read 0 hours used on retainers carrying dozens of briefs.
  const { data: allocMonths = [] } = useRetainerAllocation();
  const alloc = useMemo(() => {
    const m = allocMonths.find((x) => x.month === month) ?? allocMonths[0];
    return new Map((m?.rows ?? []).filter((r) => r.projectId).map((r) => [r.projectId!, r]));
  }, [allocMonths, month]);

  // Every line the month produced that is NOT one of the retainers listed
  // above: ad hoc work, retainer work with no retainer to hang off, our own
  // brands, and fixed-price projects. These used to be a parenthetical on the
  // client header — "(8h off-retainer)" — which is how a whole category of
  // work stayed invisible. They are rows now, one per category per client.
  const extrasByClient = useMemo(() => {
    const m = allocMonths.find((x) => x.month === month) ?? allocMonths[0];
    const retainerIds = new Set(retainers.map((r) => r.id));
    const byClient = new Map<string, AllocationRow[]>();
    for (const r of m?.rows ?? []) {
      if (r.projectId && retainerIds.has(r.projectId)) continue;
      if (r.deliveredHours <= 0 && r.openPoints <= 0) continue;
      (byClient.get(r.clientName) ?? byClient.set(r.clientName, []).get(r.clientName)!).push(r);
    }
    return byClient;
  }, [allocMonths, month, retainers]);

  const clientGroups = useMemo(() => {
    const map = new Map<string, typeof filteredRetainers>();
    for (const r of filteredRetainers) {
      const key = r.client_name ?? "—";
      (map.get(key) ?? map.set(key, []).get(key)!).push(r);
    }
    // A client with only ad hoc work has no retainer to seed a group, and
    // dropping them is how ad hoc work disappears from the page entirely.
    for (const clientName of extrasByClient.keys()) {
      if (map.has(clientName)) continue;
      if (selectedClients.size > 0 && !selectedClients.has(clientName)) continue;
      if (q && !clientName.toLowerCase().includes(q)) continue;
      map.set(clientName, []);
    }
    return [...map.entries()].map(([clientName, rows]) => {
      const extras = extrasByClient.get(clientName) ?? [];
      return {
      clientName,
      // Every retainer in a group belongs to the same client, so the flag is
      // the client's (0152) — read off the first row.
      isInternal: rows[0]?.client_is_internal ?? extras[0]?.isInternal ?? false,
      rows,
      extras,
      totalFeeCents: rows.reduce(
        (sum, r) => sum + (r.retainer_monthly_fee_cents ?? 0),
        0,
      ),
      sold: rows.reduce((sum, r) => sum + (alloc.get(r.id)?.soldHours ?? 0), 0),
      committed: rows.reduce((sum, r) => sum + (alloc.get(r.id)?.committedHours ?? 0), 0),
      delivered:
        rows.reduce((sum, r) => sum + (alloc.get(r.id)?.deliveredHours ?? 0), 0) +
        extras.reduce((sum, r) => sum + r.deliveredHours, 0),
      open:
        rows.reduce((sum, r) => sum + (alloc.get(r.id)?.openPoints ?? 0) * 0.25, 0) +
        extras.reduce((sum, r) => sum + r.openPoints * 0.25, 0),
      };
    });
  }, [filteredRetainers, alloc, extrasByClient, selectedClients, q]);

  // Our own brands are shown apart from the client book. They keep their fee —
  // Lisa: "internal, you can keep the revenue - worth having a view of it for
  // management" — but a month is judged on the client half, so summing the two
  // together would flatter every ratio on the page.
  const sections = useMemo(() => {
    const totals = (groups: typeof clientGroups) => ({
      fee: groups.reduce((n, g) => n + g.totalFeeCents, 0),
      sold: groups.reduce((n, g) => n + g.sold, 0),
      committed: groups.reduce((n, g) => n + g.committed, 0),
      delivered: groups.reduce((n, g) => n + g.delivered, 0),
    });
    const client = clientGroups.filter((g) => !g.isInternal);
    const internal = clientGroups.filter((g) => g.isInternal);
    return [
      { label: "Client work", groups: client, ...totals(client) },
      { label: "Internal work", groups: internal, ...totals(internal) },
    ].filter((s) => s.groups.length > 0);
  }, [clientGroups]);

  const hasFilters = selectedClients.size > 0 || selectedStatuses.size > 0;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Clients start closed: the point of the page is the rollup, with the
  // retainers behind it a click away rather than a wall on arrival.
  const [openClients, setOpenClients] = useState<Record<string, boolean>>({});

  function toggleExpanded(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleClient(name: string) {
    setSelectedClients((prev) => toggleInSet(prev, name));
  }

  function toggleStatus(status: string) {
    setSelectedStatuses((prev) => toggleInSet(prev, status));
  }

  function handleSync(projectId?: string, label?: string) {
    sync.mutate(projectId, {
      onSuccess: () => toast.success(label ? `Synced ${label}` : "Synced all retainers"),
      onError: (err) => toast.error(`Sync failed: ${errorMessage(err)}`),
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
            className="h-10 pl-8"
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
              className="h-10 rounded-md border border-m-outline-variant bg-transparent px-3 py-1.5 text-body-small text-m-on-surface"
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
                    <TableHead className="whitespace-nowrap text-right" title="What the monthly fee buys at the standard rate">Planned</TableHead>
                    <TableHead className="whitespace-nowrap text-right" title="Recurring tasks set up to repeat each month. Work briefed ad hoc is not scheduled and does not appear here.">Scheduled</TableHead>
                    <TableHead className="whitespace-nowrap text-right" title="Work that actually closed this month">Completed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections.map((section) => (
                    <Fragment key={section.label}>
                    {/* A divider is only worth a row when there is something on
                        both sides of it — one section is just the table. */}
                    {sections.length > 1 && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell className="w-px bg-m-surface-container pb-1 pt-4" />
                        <TableCell className="bg-m-surface-container pb-1 pt-4 text-label-large uppercase tracking-wide text-m-on-surface-variant">
                          {section.label}
                        </TableCell>
                        <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium text-m-on-surface">
                          {section.fee > 0 ? formatZar(section.fee) : "—"}
                        </TableCell>
                        <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                          {fmtHours(section.sold)}
                        </TableCell>
                        <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                          {fmtHours(section.committed)}
                        </TableCell>
                        <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium font-semibold text-m-on-surface">
                          {fmtHours(section.delivered)}
                        </TableCell>
                        <TableCell className="bg-m-surface-container pb-1 pt-4" />
                        <TableCell className="bg-m-surface-container pb-1 pt-4" />
                      </TableRow>
                    )}
                    {section.groups.map((group) => (
                    <Fragment key={group.clientName}>
                      <TableRow
                        role="button"
                        tabIndex={0}
                        aria-expanded={!!openClients[group.clientName]}
                        aria-label={`${openClients[group.clientName] ? "Hide" : "Show"} retainers for ${group.clientName}`}
                        className="cursor-pointer hover:bg-m-surface-container"
                        onClick={() =>
                          setOpenClients((p) => ({ ...p, [group.clientName]: !p[group.clientName] }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpenClients((p) => ({ ...p, [group.clientName]: !p[group.clientName] }));
                          }
                        }}
                      >
                        <TableCell className="w-px border-b border-m-outline-variant bg-m-surface-container-low pr-0">
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 text-m-on-surface-variant transition-transform",
                              openClients[group.clientName] && "rotate-90",
                            )}
                          />
                        </TableCell>
                        <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low py-2">
                          <span className="text-title-small font-semibold text-m-on-surface">
                            {group.clientName}
                          </span>
                          <span className="ml-2 text-label-small text-m-on-surface-variant">
                            {group.rows.length} retainer{group.rows.length !== 1 ? "s" : ""}
                          </span>
                        </TableCell>
                        <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low text-right font-mono tabular-nums text-body-medium text-m-on-surface">
                          {group.totalFeeCents > 0 ? formatZar(group.totalFeeCents) : "—"}
                        </TableCell>
                        <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                          {fmtHours(group.sold)}
                        </TableCell>
                        <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                          {fmtHours(group.committed)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "border-b border-m-outline-variant bg-m-surface-container-low text-right font-mono tabular-nums text-body-medium font-semibold",
                            deliveredTone(group.delivered, group.sold || group.committed),
                          )}
                        >
                          {fmtHours(group.delivered)}
                          {group.open > 0 && (
                            <span className="ml-1 text-label-small font-normal text-m-on-surface-variant" title="Raised and still open">
                              +{fmtHours(group.open)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low" />
                        <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low" />
                      </TableRow>
                      {openClients[group.clientName] && group.rows.map((r) => (
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
                            <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                              {fmtHours(alloc.get(r.id)?.soldHours ?? 0)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                              {fmtHours(alloc.get(r.id)?.committedHours ?? 0)}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right font-mono tabular-nums text-body-medium font-semibold",
                                deliveredTone(
                                  alloc.get(r.id)?.deliveredHours ?? 0,
                                  (alloc.get(r.id)?.soldHours || alloc.get(r.id)?.committedHours) ?? 0,
                                ),
                              )}
                            >
                              {fmtHours(alloc.get(r.id)?.deliveredHours ?? 0)}
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
                                          toast.error(`Failed to delete retainer: ${errorMessage(err)}`),
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
                      {/* The other categories. No Planned or Scheduled: nobody
                          budgeted an hour of ad hoc work in advance, and
                          printing a 0 there would read as a target missed. */}
                      {openClients[group.clientName] && group.extras.map((x) => (
                        <TableRow key={x.key} className="[&>td]:py-2">
                          <TableCell className="w-px" />
                          <TableCell className="text-body-medium text-m-on-surface">
                            {x.name}
                            <Badge variant="secondary" className="ml-2 whitespace-nowrap">
                              {CATEGORY_LABEL[x.kind]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            —
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            —
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            —
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-body-medium font-semibold text-m-on-surface">
                            {fmtHours(x.deliveredHours)}
                            {x.openPoints > 0 && (
                              <span className="ml-1 text-label-small font-normal text-m-on-surface-variant" title="Raised and still open">
                                +{fmtHours(x.openPoints * 0.25)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-label-small text-m-on-surface-variant">
                            {x.briefCount > 0 ? `${x.briefCount} brief${x.briefCount !== 1 ? "s" : ""}` : ""}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      ))}
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
