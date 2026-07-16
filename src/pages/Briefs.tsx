import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ChevronRight, Copy, MessageSquare, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  type PipelineSelection,
} from "@/components/briefs/StatusPipeline";
import { BriefConversation } from "@/components/BriefConversation";
import { DuplicateBriefDialog } from "@/components/briefs/DuplicateBriefDialog";
import { useBrief, useBriefs, useUpdateBrief } from "@/hooks/useBriefs";
import { useClients } from "@/hooks/useClients";
import { STATUS_LABEL, BILLING_LABEL, resumeHref, type BriefStatus, type BillingType } from "@/lib/brief-routing";

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

export function Briefs() {
  const navigate = useNavigate();
  const { briefId } = useParams<{ briefId?: string }>();
  const { data: selectedBrief } = useBrief(briefId);
  const { data: allBriefs = [] } = useBriefs("all");
  const { data: archivedBriefs = [] } = useBriefs("archived");
  const { data: clients = [] } = useClients();
  const updateBrief = useUpdateBrief();

  const [pipelineStatus, setPipelineStatus] = useState<PipelineSelection>("all");
  const [duplicating, setDuplicating] = useState<(typeof allBriefs)[number] | null>(null);
  const [search, setSearch] = useState("");
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedBilling, setSelectedBilling] = useState<Set<BillingType>>(new Set());

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

  // "All" means the live pipeline — archived only shows via its own pill.
  const filteredBriefs = useMemo(
    () =>
      pipelineStatus === "all"
        ? pipelineBriefs.filter((b) => b.status !== "archived")
        : pipelineBriefs.filter((b) => b.status === pipelineStatus),
    [pipelineBriefs, pipelineStatus],
  );

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
    setSelectedClients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleBilling = (t: BillingType) => {
    setSelectedBilling((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  return (
    <div className="flex h-full">
      {/* ── Left filter rail: search on top → divider → filter groups below ── */}
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
        </div>

        {clientOptions.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-label-medium text-m-on-surface-variant">Client</h4>
            <div className="space-y-0.5">
              {clientOptions.map((c) => {
                const active = selectedClients.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleClient(c.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-label-medium tracking-normal transition-colors ${
                      active
                        ? "bg-m-secondary-container text-m-on-secondary-container"
                        : "text-m-on-surface hover:bg-m-surface-container"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        active
                          ? "border-m-primary bg-m-primary text-m-on-primary"
                          : "border-m-outline"
                      }`}
                    >
                      {active && (
                        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {billingOptions.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-label-medium text-m-on-surface-variant">Billing</h4>
            <div className="space-y-0.5">
              {billingOptions.map((t) => {
                const active = selectedBilling.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleBilling(t)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-label-medium tracking-normal transition-colors ${
                      active
                        ? "bg-m-secondary-container text-m-on-secondary-container"
                        : "text-m-on-surface hover:bg-m-surface-container"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        active
                          ? "border-m-primary bg-m-primary text-m-on-primary"
                          : "border-m-outline"
                      }`}
                    >
                      {active && (
                        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{BILLING_LABEL[t]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-headline-medium">Briefs</h1>
          <Button asChild>
            <Link to="/briefs/new">+ New Brief</Link>
          </Button>
        </div>

        {visibleBriefs.length === 0 ? (
          <div className="text-body-medium text-m-on-surface-variant">
            No open briefs. New briefs land in the Inbox and become in-flight once triaged.
          </div>
        ) : (
          <>
            <StatusPipeline
              counts={statusCounts}
              active={pipelineStatus}
              onSelect={setPipelineStatus}
              showArchived
              className="mb-6"
            />

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
                            return (
                              <TableRow
                                key={b.id}
                                onClick={() => navigate(rowHref(b))}
                                className="cursor-pointer [&>td]:py-2"
                              >
                                <TableCell className="w-px pr-0 text-m-on-surface-variant">
                                  <ChevronRight className="h-4 w-4" />
                                </TableCell>
                                <TableCell className="max-w-[420px]">
                                  <div className="whitespace-normal break-words text-body-medium text-m-on-surface">
                                    {b.raw_subject ?? "(no subject)"}
                                  </div>
                                  <div className="text-label-small text-m-on-surface-variant">
                                    {b.sender_email ?? "manual"} ·{" "}
                                    {new Date(b.created_at).toLocaleDateString("en-ZA")}
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
      </div>
    </div>
  );
}
