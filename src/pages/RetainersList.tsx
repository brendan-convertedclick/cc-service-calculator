import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, Plus, Trash2, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { currentMonthKey } from "@/hooks/usePulseRetainerBurn";
import { useSyncActuals } from "@/hooks/useSyncActuals";
import { useRetainerAllocation, type AllocationRow } from "@/hooks/useRetainerAllocation";
import { RetainerSubItems } from "@/components/retainers/RetainerSubItems";
import { formatZar, cn, errorMessage } from "@/lib/utils";
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
    const map = new Map<string, typeof sortedRetainers>();
    for (const r of sortedRetainers) {
      const key = r.client_name ?? "—";
      (map.get(key) ?? map.set(key, []).get(key)!).push(r);
    }
    // Deliberately NOT seeded from extrasByClient. Lisa: "I want to keep
    // Retainers strictly to invoiced items." A client with ad hoc work and no
    // retainer — A Love Supreme — is not a retainer client; their work still
    // lives in Briefs and in ClickUp, it is just not measured here.
    return [...map.entries()].map(([clientName, allRows]) => {
      const extras = extrasByClient.get(clientName) ?? [];
      // A retainer with neither a fee nor an hours target is the open shape —
      // Trellidor's ad hoc one. Its work is already counted on the client's Ad
      // hoc line, so showing the project too would print it twice.
      const rows = allRows.filter(
        (r) => r.retainer_monthly_fee_cents != null || r.retainer_hours_target != null,
      );
      // Real recurring work that no invoice covers: plugin updates carried by
      // the hosting fee, meetings we do not charge for. Kept visible, with
      // what pays for it, but out of the retainer book — 10 planned hours a
      // month against zero revenue is exactly what distorted the numbers.
      // A standing monthly task is not a retainer engagement (0154): still
      // provisioned every month, but it answers "is this getting done", not
      // "is this client's retainer being serviced".
      const recurring = rows.filter((r) => r.is_recurring_task);
      const retainerRows = rows.filter((r) => !r.is_recurring_task);
      const billed = retainerRows.filter((r) => (r.retainer_monthly_fee_cents ?? 0) > 0);
      const unbilled = retainerRows.filter((r) => (r.retainer_monthly_fee_cents ?? 0) === 0);
      return {
      clientName,
      // Every retainer in a group belongs to the same client, so the flag is
      // the client's (0152) — read off the first row.
      isInternal: rows[0]?.client_is_internal ?? extras[0]?.isInternal ?? false,
      rows: billed,
      unbilled,
      recurring,
      extras,
      totalFeeCents: billed.reduce(
        (sum, r) => sum + (r.retainer_monthly_fee_cents ?? 0),
        0,
      ),
      // Planned and Scheduled are the retainer book: what a fee bought and what
      // is set up to repeat for it. Unbilled work has hours but no fee, so it
      // belongs in neither total.
      sold: billed.reduce((sum, r) => sum + (alloc.get(r.id)?.soldHours ?? 0), 0),
      committed: billed.reduce((sum, r) => sum + (alloc.get(r.id)?.committedHours ?? 0), 0),
      // Completed counts everything: work done is work done, whoever paid.
      delivered:
        retainerRows.reduce((sum, r) => sum + (alloc.get(r.id)?.deliveredHours ?? 0), 0) +
        extras.reduce((sum, r) => sum + r.deliveredHours, 0),
      open:
        retainerRows.reduce((sum, r) => sum + (alloc.get(r.id)?.openPoints ?? 0) * 0.25, 0) +
        extras.reduce((sum, r) => sum + r.openPoints * 0.25, 0),
      };
    });
  }, [sortedRetainers, alloc, extrasByClient]);

  // Our own brands are shown apart from the client book. They keep their fee —
  // Lisa: "internal, you can keep the revenue - worth having a view of it for
  // management" — but a month is judged on the client half, so summing the two
  // together would flatter every ratio on the page.
  // The standing monthly tasks, regrouped as their own book. Same shape as a
  // client group so the table renders it without a second code path.
  const recurringGroups = useMemo(
    () =>
      clientGroups
        .filter((g) => g.recurring.length > 0)
        .map((g) => ({
          ...g,
          rows: g.recurring,
          unbilled: [],
          recurring: [],
          extras: [],
          // Recomputed, never spread: the totals on g are the client's RETAINER
          // book, and carrying them onto a standing-task row would print
          // Trellidor's R59,637 over four tasks worth nothing.
          totalFeeCents: g.recurring.reduce((n, r) => n + (r.retainer_monthly_fee_cents ?? 0), 0),
          sold: g.recurring.reduce((n, r) => n + (alloc.get(r.id)?.soldHours ?? 0), 0),
          committed: g.recurring.reduce((n, r) => n + (alloc.get(r.id)?.committedHours ?? 0), 0),
          delivered: g.recurring.reduce((n, r) => n + (alloc.get(r.id)?.deliveredHours ?? 0), 0),
          open: g.recurring.reduce((n, r) => n + (alloc.get(r.id)?.openPoints ?? 0) * 0.25, 0),
        })),
    [clientGroups, alloc],
  );

  const sections = useMemo(() => {
    const totals = (groups: typeof clientGroups) => ({
      fee: groups.reduce((n, g) => n + g.totalFeeCents, 0),
      sold: groups.reduce((n, g) => n + g.sold, 0),
      committed: groups.reduce((n, g) => n + g.committed, 0),
      delivered: groups.reduce((n, g) => n + g.delivered, 0),
    });
    // A client belongs on this tab only if they hold a retainer. Ad hoc work
    // alone does not put them here — OracleMed's plugin line became a standing
    // task, so their ad hoc briefs would otherwise have walked them straight
    // back onto the page Lisa had just taken them off.
    const client = clientGroups.filter(
      (g) => !g.isInternal && g.rows.length + g.unbilled.length > 0,
    );
    const internal = clientGroups.filter((g) => g.isInternal);
    return [
      { key: "client" as const, label: "Client work", groups: client, ...totals(client) },
      { key: "internal" as const, label: "Internal", groups: internal, ...totals(internal) },
      {
        key: "recurring" as const,
        label: "Recurring tasks",
        groups: recurringGroups,
        // A recurring task's fee is a real monthly invoice: out of the retainer
        // book, not out of the accounts.
        ...totals(recurringGroups),
      },
    ];
  }, [clientGroups, recurringGroups]);

  const [tab, setTab] = useState<"client" | "internal" | "recurring">("client");
  const section = sections.find((s) => s.key === tab) ?? sections[0];
  // Our own brands carry a notional fee so we can see what the work would be
  // worth, but it is not revenue and printing it in a money column next to the
  // client book invites the two being added up.
  const showFee = tab !== "internal";

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Clients start closed: the point of the page is the rollup, with the
  // retainers behind it a click away rather than a wall on arrival.
  const [openClients, setOpenClients] = useState<Record<string, boolean>>({});

  function toggleExpanded(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleSync(projectId?: string, label?: string) {
    sync.mutate(projectId, {
      onSuccess: () => toast.success(label ? `Synced ${label}` : "Synced all retainers"),
      onError: (err) => toast.error(`Sync failed: ${errorMessage(err)}`),
    });
  }

  return (
    <div className="flex h-full">
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

        {/* Client work and our own brands are two different books. A tab keeps
            the page answering one question at a time. */}
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "client" | "internal" | "recurring")}
          className="mb-4"
        >
          <TabsList>
            {sections.map((sec) => (
              <TabsTrigger key={sec.key} value={sec.key}>
                {sec.label}
                <span className="ml-2 text-label-small text-m-on-surface-variant">
                  {fmtHours(sec.delivered)}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

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
                    <Fragment key={section.key}>
                    {/* The tab's own totals, on the row above its clients. */}
                    {(
                      <TableRow className="hover:bg-transparent">
                        <TableCell className="w-px bg-m-surface-container pb-1 pt-4" />
                        <TableCell className="bg-m-surface-container pb-1 pt-4 text-label-large uppercase tracking-wide text-m-on-surface-variant">
                          {section.label}
                        </TableCell>
                        <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium text-m-on-surface">
                          {showFee && section.fee > 0 ? formatZar(section.fee) : "—"}
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
                          {showFee && group.totalFeeCents > 0 ? formatZar(group.totalFeeCents) : "—"}
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
                              {showFee && r.retainer_monthly_fee_cents != null
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
                      {/* Recurring work with no invoice behind it. It keeps its
                          hours — the work is real and someone has to do it —
                          but they are not in the Planned and Scheduled totals
                          above, because no fee bought them. */}
                      {openClients[group.clientName] && group.unbilled.map((r) => (
                        <TableRow
                          key={r.id}
                          onClick={() => navigate(`/projects/${r.id}`)}
                          className="cursor-pointer [&>td]:py-2"
                        >
                          <TableCell className="w-px" />
                          <TableCell className="text-body-medium text-m-on-surface">
                            {displayRetainerName(r.name, r.client_name)}
                            <Badge variant="secondary" className="ml-2 whitespace-nowrap">
                              {r.revenue_source ?? "No fee — source not set"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            —
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            {fmtHours(alloc.get(r.id)?.soldHours ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            {fmtHours(alloc.get(r.id)?.committedHours ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-body-medium font-semibold text-m-on-surface">
                            {fmtHours(alloc.get(r.id)?.deliveredHours ?? 0)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(r.status)} className="whitespace-nowrap">
                              {statusLabel(r.status)}
                            </Badge>
                          </TableCell>
                          <TableCell />
                        </TableRow>
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
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <div className="text-body-medium text-m-on-surface-variant">
            Nothing on this tab for the month you picked.
          </div>
        )}
      </div>
    </div>
  );
}
