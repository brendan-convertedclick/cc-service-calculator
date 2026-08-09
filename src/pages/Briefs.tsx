import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Calendar, Clock, Copy, Flag, MessageSquare, PanelLeftClose, PanelLeftOpen, Pencil, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterGroup, FilterOption } from "@/components/filters/FilterRail";
import { toggleInSet } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PIPELINE_STATUSES,
  StatusPipeline,
  EXECUTION_BUCKETS,
  type PipelineSelection,
  type ExecutionBucket,
} from "@/components/briefs/StatusPipeline";
import { BriefConversation } from "@/components/BriefConversation";
import { DuplicateBriefDialog } from "@/components/briefs/DuplicateBriefDialog";
import { EditBriefedTaskDialog } from "@/components/briefs/EditBriefedTaskDialog";
import { DeliveryFilter } from "@/components/briefs/DeliveryFilter";
import { useBrief, useBriefs, useCreateBrief, useUpdateBrief } from "@/hooks/useBriefs";
import {
  progressFromStatuses,
  useScheduledTaskStatuses,
  type BriefTaskProgress,
} from "@/hooks/useBriefTaskProgress";
import { useClients } from "@/hooks/useClients";
import { STATUS_LABEL, BILLING_LABEL, resumeHref, type BriefStatus, type BillingType } from "@/lib/brief-routing";
import { briefDate } from "@/components/BriefList";

// Every status shown anywhere on this page — the lifecycle pipeline order.
// `rejected`/`spam` are deliberately excluded (dead-end noise); `archived` is
// already excluded by useBriefs("all").
const VISIBLE_STATUSES: BriefStatus[] = PIPELINE_STATUSES;

// Clicking a row always opens the brief's staged page (the full flow lives
// there now, including Cost Estimate and Approve & Schedule). The email
// conversation drawer is reached via the per-row thread button instead.
function rowHref(b: { id: string; status: BriefStatus }): string {
  return resumeHref(b as Parameters<typeof resumeHref>[0]);
}

/** Mini progress bar for a briefed row's handed-off ClickUp work. */
function BriefProgress({ progress }: { progress: BriefTaskProgress }) {
  return (
    <div
      className="flex items-center gap-1.5"
      title={`${progress.done}/${progress.total} task${progress.total !== 1 ? "s" : ""} done in ClickUp`}
    >
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-m-surface-container-high">
        <div
          className="h-full rounded-full bg-m-primary transition-[width]"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      <span className="font-mono text-label-small tabular-nums text-m-on-surface-variant">
        {progress.pct}%
      </span>
    </div>
  );
}

// Rail filters survive navigating into a brief and back (component unmounts,
// so plain state resets). Session-scoped on purpose: a fresh tab starts clean.
const FILTERS_KEY = "briefs-filters-v1";
type PersistedFilters = {
  pipelineStatus: PipelineSelection;
  search: string;
  clients: string[];
  billing: BillingType[];
  railOpen?: boolean;
};
function loadFilters(): Partial<PersistedFilters> {
  try {
    return JSON.parse(sessionStorage.getItem(FILTERS_KEY) ?? "{}") as Partial<PersistedFilters>;
  } catch {
    return {};
  }
}

export function Briefs() {
  const navigate = useNavigate();
  const { briefId } = useParams<{ briefId?: string }>();
  const { data: selectedBrief } = useBrief(briefId);
  const { data: allBriefs = [] } = useBriefs("all");
  const { data: archivedBriefs = [] } = useBriefs("archived");
  const { data: clients = [] } = useClients();
  const updateBrief = useUpdateBrief();
  const createBrief = useCreateBrief();
  const { data: scheduledStatuses } = useScheduledTaskStatuses();

  const [pipelineStatus, setPipelineStatus] = useState<PipelineSelection>(
    () => loadFilters().pipelineStatus ?? "all",
  );
  const [duplicating, setDuplicating] = useState<(typeof allBriefs)[number] | null>(null);
  const [editingTask, setEditingTask] = useState<(typeof allBriefs)[number] | null>(null);
  const [search, setSearch] = useState(() => loadFilters().search ?? "");
  const [selectedClients, setSelectedClients] = useState<Set<string>>(
    () => new Set(loadFilters().clients ?? []),
  );
  const [selectedBilling, setSelectedBilling] = useState<Set<BillingType>>(
    () => new Set(loadFilters().billing ?? []),
  );
  const [railOpen, setRailOpen] = useState(() => loadFilters().railOpen ?? true);

  useEffect(() => {
    const filters: PersistedFilters = {
      pipelineStatus,
      search,
      clients: Array.from(selectedClients),
      billing: Array.from(selectedBilling),
      railOpen,
    };
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  }, [pipelineStatus, search, selectedClients, selectedBilling, railOpen]);

  const handleArchiveToggle = async (
    id: string,
    isArchived: boolean,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await updateBrief.mutateAsync({
        id,
        patch: { status: isArchived ? "new" : "archived" },
      });
      toast.success(isArchived ? "Brief restored" : "Brief archived");
    } catch {
      toast.error("Failed to update brief");
    }
  };

  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  // Everything the page can ever show, newest first. Archived briefs ride
  // along so the pipeline's Archived pill can filter to them.
  const visibleBriefs = useMemo(
    () =>
      [
        ...allBriefs.filter((b) => VISIBLE_STATUSES.includes(b.status as BriefStatus)),
        ...archivedBriefs,
      ].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [allBriefs, archivedBriefs],
  );

  const clientOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const b of visibleBriefs) if (b.client_id) ids.add(b.client_id);
    return Array.from(ids)
      .map((id) => ({ id, name: clientById.get(id) ?? "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [visibleBriefs, clientById]);

  const billingOptions = useMemo(() => {
    const set = new Set<BillingType>();
    for (const b of visibleBriefs) {
      set.add(b.billing_type === "adhoc" ? "adhoc" : "retainer");
    }
    return Array.from(set).sort();
  }, [visibleBriefs]);

  const q = search.trim().toLowerCase();

  // Everything matching the rail filters + search, before the pipeline's
  // status selection — this is the population the pipeline counts reflect.
  const pipelineBriefs = useMemo(
    () =>
      visibleBriefs.filter((b) => {
        if (selectedClients.size > 0 && (!b.client_id || !selectedClients.has(b.client_id))) {
          return false;
        }
        if (selectedBilling.size > 0) {
          const billing: BillingType = b.billing_type === "adhoc" ? "adhoc" : "retainer";
          if (!selectedBilling.has(billing)) return false;
        }
        if (q) {
          const clientName = b.client_id ? clientById.get(b.client_id) ?? "" : "";
          const hay = `${b.raw_subject ?? ""} ${b.sender_email ?? ""} ${clientName}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [visibleBriefs, selectedClients, selectedBilling, q, clientById],
  );

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<BriefStatus, number>> = {};
    for (const b of pipelineBriefs) {
      const s = b.status as BriefStatus;
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [pipelineBriefs]);

  // Post-briefed execution bucket per brief, from the ClickUp status its tasks
  // are in (scheduled placement_tasks when present, else the quick-briefed
  // task). Only briefed briefs with a synced status land in a bucket.
  const executionByBrief = useMemo(() => {
    const map = new Map<string, ExecutionBucket>();
    for (const b of pipelineBriefs) {
      if (b.status !== "briefed") continue;
      const statuses =
        scheduledStatuses?.get(b.id) ?? (b.clickup_task_status ? [b.clickup_task_status] : []);
      const progress = progressFromStatuses(statuses);
      if (!progress) continue;
      if (progress.done === progress.total) map.set(b.id, "completed");
      else if (progress.pct > 0) map.set(b.id, "in_progress");
      else {
        // Nothing done or in flight yet — split the idle states by raw status.
        const s = statuses.map((x) => x.toLowerCase());
        if (s.some((x) => x === "waiting on client")) map.set(b.id, "waiting_on_client");
        else if (s.some((x) => x === "planned")) map.set(b.id, "planned");
        else map.set(b.id, "backlog");
      }
    }
    return map;
  }, [pipelineBriefs, scheduledStatuses]);

  const executionCounts = useMemo(() => {
    const c: Record<ExecutionBucket, number> = {
      backlog: 0,
      planned: 0,
      in_progress: 0,
      waiting_on_client: 0,
      completed: 0,
    };
    for (const bucket of executionByBrief.values()) c[bucket] += 1;
    return c;
  }, [executionByBrief]);

  // "All" means the live pipeline — archived only shows via its own pill. The
  // execution buckets filter briefed briefs by their ClickUp task status.
  const filteredBriefs = useMemo(() => {
    if (pipelineStatus === "all") return pipelineBriefs.filter((b) => b.status !== "archived");
    if ((EXECUTION_BUCKETS as string[]).includes(pipelineStatus)) {
      return pipelineBriefs.filter((b) => executionByBrief.get(b.id) === pipelineStatus);
    }
    return pipelineBriefs.filter((b) => b.status === pipelineStatus);
  }, [pipelineBriefs, pipelineStatus, executionByBrief]);

  // Collapse the client column into per-client groups (matches the Retainers
  // list); rows keep their newest-first order within each client.
  const briefGroups = useMemo(() => {
    const map = new Map<string, typeof filteredBriefs>();
    for (const b of filteredBriefs) {
      const key = b.client_id ? clientById.get(b.client_id) ?? "Unknown" : "Unassigned";
      (map.get(key) ?? map.set(key, []).get(key)!).push(b);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([clientName, rows]) => ({ clientName, rows }));
  }, [filteredBriefs, clientById]);

  const hasFilters = selectedClients.size > 0 || selectedBilling.size > 0;

  const toggleClient = (id: string) => {
    setSelectedClients((prev) => toggleInSet(prev, id));
  };

  const toggleBilling = (t: BillingType) => {
    setSelectedBilling((prev) => toggleInSet(prev, t));
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* ── Left filter rail: search on top → divider → filter groups below.
             Collapsible so the brief rows get the full width. ── */}
      {!railOpen ? (
        <aside className="flex w-10 shrink-0 flex-col items-center border-r border-m-outline-variant py-3">
          <button
            type="button"
            aria-label="Show filters"
            title="Show filters"
            onClick={() => setRailOpen(true)}
            className="relative grid h-8 w-8 place-items-center rounded-md text-m-on-surface-variant transition-colors hover:bg-m-surface-container hover:text-m-on-surface"
          >
            <PanelLeftOpen className="h-4 w-4" />
            {(hasFilters || search.trim() !== "") && (
              <span
                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-m-primary"
                aria-label="Filters active"
              />
            )}
          </button>
        </aside>
      ) : (
      <aside className="w-56 shrink-0 space-y-5 overflow-y-auto border-r border-m-outline-variant p-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
          <Input
            aria-label="Search briefs"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8"
          />
        </div>

        <div className="flex items-center justify-between">
          <h3 className="text-label-large text-m-on-surface">Filters</h3>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <button
                type="button"
                onClick={() => {
                  setSelectedClients(new Set());
                  setSelectedBilling(new Set());
                }}
                className="text-label-small text-m-primary hover:underline"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              aria-label="Hide filters"
              title="Hide filters"
              onClick={() => setRailOpen(false)}
              className="grid h-6 w-6 place-items-center rounded-md text-m-on-surface-variant transition-colors hover:bg-m-surface-container hover:text-m-on-surface"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        </div>

        {clientOptions.length > 0 && (
          <FilterGroup label="Client">
            {clientOptions.map((c) => (
              <FilterOption
                key={c.id}
                label={c.name}
                active={selectedClients.has(c.id)}
                onToggle={() => toggleClient(c.id)}
              />
            ))}
          </FilterGroup>
        )}

        {billingOptions.length > 0 && (
          <FilterGroup label="Billing">
            {billingOptions.map((t) => (
              <FilterOption
                key={t}
                label={BILLING_LABEL[t]}
                active={selectedBilling.has(t)}
                onToggle={() => toggleBilling(t)}
              />
            ))}
          </FilterGroup>
        )}
      </aside>
      )}

      {/* ── Main: frozen banner (title + pipeline) over a scrolling list ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 space-y-4 px-6 pb-4 pt-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-headline-medium">Briefs</h1>
            <Button
              disabled={createBrief.isPending}
              onClick={() =>
                createBrief
                  .mutateAsync({
                    source: "manual",
                    status: "new",
                    raw_subject: null,
                    raw_body: "",
                  })
                  .then((b) => navigate(`/briefs/${b.id}/scope`))
                  .catch(() => toast.error("Failed to create the brief"))
              }
            >
              {createBrief.isPending ? "Creating…" : "+ New Brief"}
            </Button>
          </div>
          {visibleBriefs.length > 0 && (
            <div className="space-y-2">
              <StatusPipeline
                counts={statusCounts}
                active={pipelineStatus}
                onSelect={setPipelineStatus}
                showArchived
              />
              {(statusCounts.briefed ?? 0) > 0 && (
                <DeliveryFilter
                  counts={executionCounts}
                  active={pipelineStatus}
                  onSelect={setPipelineStatus}
                />
              )}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-6">
        {visibleBriefs.length === 0 ? (
          <div className="text-body-medium text-m-on-surface-variant">
            No open briefs. New briefs land in the Inbox and become in-flight once triaged.
          </div>
        ) : (
          <>
            {filteredBriefs.length > 0 ? (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-px" />
                        <TableHead>Name</TableHead>
                        <TableHead>Billing</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-px" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {briefGroups.map((group) => (
                        <Fragment key={group.clientName}>
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
                                  {group.rows.length} brief{group.rows.length !== 1 ? "s" : ""}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                          {group.rows.map((b) => {
                            const isBriefed = b.status === "briefed" && !!b.clickup_task_url;
                            const isArchived = b.status === "archived";
                            const isAdhoc = b.billing_type === "adhoc";
                            // Completion flags synced from ClickUp (types lag select("*")).
                            const flags = b as unknown as {
                              over_budget?: boolean | null;
                              closed_late?: boolean | null;
                              client_wait_ms?: number | null;
                              client_delay_manual?: boolean | null;
                              original_due_date?: string | null;
                              completed_at?: string | null;
                            };
                            const overBudget = !!flags.over_budget;
                            const closedLate = !!flags.closed_late;
                            // Attribute a late close: client-caused if the days it ran over are
                            // covered by time the task spent waiting on the client.
                            const clientWaitDays =
                              flags.client_wait_ms != null ? flags.client_wait_ms / 86_400_000 : 0;
                            const daysLate =
                              closedLate && flags.original_due_date && flags.completed_at
                                ? Math.max(
                                    0,
                                    Math.round(
                                      (Date.parse(`${flags.completed_at.slice(0, 10)}T00:00:00Z`) -
                                        Date.parse(`${flags.original_due_date}T00:00:00Z`)) /
                                        86_400_000,
                                    ),
                                  )
                                : 0;
                            const clientCausedLate =
                              closedLate && daysLate > 0 && (clientWaitDays >= daysLate || !!flags.client_delay_manual);
                            const internalLate = closedLate && !clientCausedLate;
                            const flagTitle = [overBudget && "Over budget", internalLate && "Closed past due date (internal)"]
                              .filter(Boolean)
                              .join(" · ");
                            const clientLateTitle = clientCausedLate
                              ? `Closed past due — client delay (waiting on client ~${Math.max(1, Math.round(clientWaitDays))}d)`
                              : "";
                            return (
                              <TableRow
                                key={b.id}
                                onClick={() => navigate(rowHref(b))}
                                className="cursor-pointer [&>td]:py-2"
                              >
                                <TableCell className="w-px whitespace-nowrap pr-2">
                                  <time
                                    title={briefDate(b.created_at).title}
                                    className="flex w-20 shrink-0 items-center gap-1.5 font-mono text-label-small tabular-nums text-m-on-surface-variant"
                                  >
                                    <Calendar className="h-3.5 w-3.5 shrink-0 text-m-outline" aria-hidden />
                                    {briefDate(b.created_at).label}
                                  </time>
                                </TableCell>
                                <TableCell className="max-w-[420px]">
                                  <div className="flex items-start gap-1.5">
                                    {(flagTitle || clientLateTitle) && (
                                      <span className="mt-0.5 flex shrink-0 items-center gap-0.5">
                                        {flagTitle && (
                                          <span title={flagTitle} aria-label={flagTitle}>
                                            <Flag className="h-3.5 w-3.5 fill-destructive text-destructive" />
                                          </span>
                                        )}
                                        {clientLateTitle && (
                                          <span title={clientLateTitle} aria-label={clientLateTitle}>
                                            <Clock className="h-3.5 w-3.5 text-amber-500" />
                                          </span>
                                        )}
                                      </span>
                                    )}
                                    <div className="whitespace-normal break-words text-body-small text-m-on-surface">
                                      {b.raw_subject ?? "(no subject)"}
                                    </div>
                                  </div>
                                  <div className="text-label-small text-m-on-surface-variant">
                                    {b.sender_email ?? "manual"}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={isAdhoc ? "warning" : "muted"} className="whitespace-nowrap">
                                    {isAdhoc ? "Adhoc" : "Retainer"}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <Badge className="whitespace-nowrap">{STATUS_LABEL[b.status]}</Badge>
                                    {isBriefed && (
                                      <a
                                        href={b.clickup_task_url!}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="whitespace-nowrap text-label-small font-medium text-m-primary hover:underline"
                                      >
                                        View task ↗
                                      </a>
                                    )}
                                  </div>
                                  {b.status === "briefed" &&
                                    (() => {
                                      // Stage-5 scheduled tasks when the brief has
                                      // them, else the single quick-briefed task.
                                      const statuses =
                                        scheduledStatuses?.get(b.id) ??
                                        (b.clickup_task_status ? [b.clickup_task_status] : []);
                                      const progress = progressFromStatuses(statuses);
                                      return progress ? (
                                        <div className="mt-1">
                                          <BriefProgress progress={progress} />
                                        </div>
                                      ) : null;
                                    })()}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label="Open email thread"
                                      title="Open email thread"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        navigate(`/briefs/view/${b.id}`);
                                      }}
                                    >
                                      <MessageSquare className="h-4 w-4" />
                                    </Button>
                                    {isBriefed && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label="Edit briefed task"
                                        title="Edit task name, points, due date"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setEditingTask(b);
                                        }}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label="Duplicate brief"
                                      title="Duplicate brief"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setDuplicating(b);
                                      }}
                                    >
                                      <Copy className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      disabled={updateBrief.isPending}
                                      aria-label={isArchived ? "Restore brief" : "Archive brief"}
                                      onClick={(e) => handleArchiveToggle(b.id, isArchived, e)}
                                    >
                                      {isArchived ? (
                                        <ArchiveRestore className="h-4 w-4" />
                                      ) : (
                                        <Archive className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <div className="text-body-medium text-m-on-surface-variant">
                No briefs match the current filters.
              </div>
            )}
          </>
        )}

        {selectedBrief && (
          <BriefConversation
            brief={selectedBrief}
            open={!!briefId}
            onClose={() => navigate("/briefs")}
          />
        )}

        <DuplicateBriefDialog
          brief={duplicating}
          open={!!duplicating}
          onOpenChange={(o) => {
            if (!o) setDuplicating(null);
          }}
        />

        <EditBriefedTaskDialog
          brief={editingTask}
          open={!!editingTask}
          onOpenChange={(o) => {
            if (!o) setEditingTask(null);
          }}
        />
        </div>
      </div>
    </div>
  );
}
