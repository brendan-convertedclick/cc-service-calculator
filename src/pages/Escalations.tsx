import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, HelpCircle, RefreshCw, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { callEdgeFn } from "@/lib/edge";
import { errorMessage, toggleInSet } from "@/lib/utils";
import { askForInfo } from "@/lib/extension-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EscalationTable, type ClientGroup } from "@/components/approvals/EscalationTable";
import { EscalationDetail } from "@/components/approvals/EscalationDetail";
import { FilterGroup, FilterOption } from "@/components/filters/FilterRail";
import {
  askedForPoints,
  holderOf,
  HOLDER_LABEL,
  type EscalationHolder,
  type EscalationRow,
  type ExtensionRequestRow,
} from "@/types/extension-requests";

const HOLDERS: EscalationHolder[] = ["owner", "admin", "requester", "done"];

/**
 * Owner escalations: every request grouped under the client paying for it, and
 * one decision at a time in a slide-over.
 *
 * Grouping by client rather than by status is deliberate — three overruns on
 * one retainer in a month is the pattern an owner needs to see, and it's
 * invisible when the same rows are split across four status buckets. Who holds
 * a request is a filter and a badge instead.
 *
 * Only `status='pending_owner'` rows are actionable; nothing reaches this page
 * without passing the admin leg first.
 */
export function Escalations() {
  const { currentUserId } = useAuth();
  const [rows, setRows] = useState<EscalationRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ id: string; kind: "reject" | "ask" } | null>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedHolders, setSelectedHolders] = useState<Set<EscalationHolder>>(new Set());
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("id");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("extension_requests")
      .select(
        "*, client:clients(id, name), requester:team_members!extension_requests_requester_id_fkey(id, full_name, email), admin_approver:team_members!extension_requests_admin_approver_id_fkey(id, full_name)",
      )
      .eq("tier", "owner")
      .order("created_at", { ascending: false });
    if (error) {
      // Never fall through to an empty list — that renders the "all clear"
      // state, which is the opposite of what a failed load means.
      toast.error(`Could not load escalations: ${error.message}`);
      setLoadError(error.message);
      setRows([]);
      return;
    }
    setLoadError(null);
    setRows((data ?? []) as unknown as EscalationRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const all = useMemo(() => rows ?? [], [rows]);
  const pending = useMemo(() => all.filter((r) => holderOf(r) === "owner"), [all]);

  /** Only clients that actually have an escalation — an empty filter is noise. */
  const clientOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of all) {
      if (r.client) seen.set(r.client.id, r.client.name);
    }
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);

  const holderCounts = useMemo(() => {
    const counts = { owner: 0, admin: 0, requester: 0, done: 0 } as Record<EscalationHolder, number>;
    for (const r of all) counts[holderOf(r)] += 1;
    return counts;
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (selectedClients.size > 0 && !(r.client && selectedClients.has(r.client.id))) return false;
      if (selectedHolders.size > 0 && !selectedHolders.has(holderOf(r))) return false;
      if (!q) return true;
      return (
        r.parent_task_name.toLowerCase().includes(q) ||
        (r.client?.name ?? "").toLowerCase().includes(q) ||
        (r.requester?.full_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [all, search, selectedClients, selectedHolders]);

  /** Grouped by client, and clients with a live decision float to the top. */
  const groups = useMemo<ClientGroup[]>(() => {
    const by = new Map<string, ClientGroup>();
    for (const r of filtered) {
      const clientId = r.client?.id ?? "none";
      const group = by.get(clientId) ?? {
        clientId,
        clientName: r.client?.name ?? "No client",
        rows: [],
      };
      group.rows.push(r);
      by.set(clientId, group);
    }
    const needsYou = (g: ClientGroup) => g.rows.filter((r) => holderOf(r) === "owner").length;
    return [...by.values()]
      .map((g) => ({
        ...g,
        // Within a client, whatever is waiting on the owner comes first.
        rows: [...g.rows].sort(
          (a, b) => Number(holderOf(b) === "owner") - Number(holderOf(a) === "owner"),
        ),
      }))
      .sort((a, b) => needsYou(b) - needsYou(a) || a.clientName.localeCompare(b.clientName));
  }, [filtered]);

  const hasFilters = selectedClients.size > 0 || selectedHolders.size > 0;

  const select = useCallback(
    (id: string) => {
      setCompose(null);
      setDraft("");
      setParams({ id }, { replace: true });
    },
    [setParams],
  );

  const close = useCallback(() => {
    setCompose(null);
    setDraft("");
    setParams({}, { replace: true });
  }, [setParams]);

  const selected = all.find((r) => r.id === selectedId) ?? null;

  // A deep link to a request that has since been actioned (or filtered away)
  // shouldn't leave a stale id in the URL pointing at nothing.
  useEffect(() => {
    if (rows === null || selectedId === null) return;
    if (!rows.some((r) => r.id === selectedId)) setParams({}, { replace: true });
  }, [rows, selectedId, setParams]);

  /** Overruns already raised for this client this month, excluding this one. */
  const priorOverruns = useMemo(() => {
    if (!selected) return 0;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return all.filter(
      (r) =>
        r.id !== selected.id &&
        r.client_id === selected.client_id &&
        // A date push that asked for no budget isn't an overrun of one.
        askedForPoints(r) &&
        r.status !== "rejected" &&
        new Date(r.created_at) >= start,
    ).length;
  }, [all, selected]);

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await callEdgeFn("approve-extension-request", { extension_request_id: id });
      toast.success("Approved.");
      close();
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    const reason = draft.trim();
    if (!reason) return toast.error("A reason is required — the requester sees it.");
    setBusyId(id);
    try {
      const { data, error } = await supabase
        .from("extension_requests")
        .update({ status: "rejected", rejected_reason: reason })
        .eq("id", id)
        .select("id");
      if (error) return toast.error(error.message);
      if (!data || data.length === 0) return toast.error("Not permitted to update this request.");
      toast.success("Rejected.");
      close();
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const ask = async (id: string) => {
    const question = draft.trim();
    if (!question) return toast.error("Write the question first.");
    setBusyId(id);
    try {
      const err = await askForInfo(id, question, currentUserId);
      if (err) return toast.error(err);
      toast.success("Sent back to the requester.");
      close();
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (rows === null) {
    return (
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 space-y-4 border-r border-m-outline-variant p-4 md:block">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-24 w-full" />
        </aside>
        <div className="min-w-0 flex-1 space-y-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* ── Left filter rail: search on top → divider → filter groups below,
             the same shape as Briefs, Projects and Scope Composer. Hidden on
             phones: beside the 56px nav it leaves ~110px for the decision,
             and this queue is short enough to scan unfiltered. ── */}
      <aside className="hidden w-56 shrink-0 space-y-5 overflow-y-auto border-r border-m-outline-variant p-4 md:block">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
          <Input
            aria-label="Search escalations"
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
                setSelectedHolders(new Set());
              }}
              className="text-label-small text-m-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        {clientOptions.length > 0 && (
          <FilterGroup label="Client">
            {clientOptions.map((c) => (
              <FilterOption
                key={c.id}
                label={c.name}
                active={selectedClients.has(c.id)}
                onToggle={() => setSelectedClients(toggle(c.id))}
              />
            ))}
          </FilterGroup>
        )}

        <FilterGroup label="Waiting on">
          {HOLDERS.map((h) => (
            <FilterOption
              key={h}
              label={HOLDER_LABEL[h]}
              count={holderCounts[h]}
              active={selectedHolders.has(h)}
              onToggle={() => setSelectedHolders(toggle(h))}
            />
          ))}
        </FilterGroup>
      </aside>

      {/* ── Main: frozen title over a scrolling list ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 px-6 pb-4 pt-6">
          <h1 className="text-headline-medium text-m-on-surface">Escalations</h1>
          <p className="mt-1 text-body-medium text-m-on-surface-variant">
            {pending.length === 0
              ? "Nothing is waiting on your decision."
              : `${pending.length} ${pending.length === 1 ? "request needs" : "requests need"} your decision.`}
          </p>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-6">
          {loadError ? (
            <Empty
              title="Couldn't load the queue."
              body={loadError}
              action={
                <Button variant="outline" size="sm" onClick={() => load()} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Try again
                </Button>
              }
            />
          ) : all.length === 0 ? (
            <Empty
              title="Nothing needs you right now."
              body="Requests land here only after an admin has approved them and the size of the ask needs an owner's call. Smaller ones never reach this page."
            />
          ) : groups.length === 0 ? (
            <Empty
              title="No escalations match these filters."
              body="Clear the filters or widen the search to see the rest of the queue."
            />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <EscalationTable groups={groups} selectedId={selectedId} onSelect={select} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── The decision itself: a slide-over, so the queue stays on screen and
             the row you came from is still where you left it. ── */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="right"
          // sheetVariants pins the panel at 440px, which squeezes the evidence
          // into a column too narrow to read. The decision needs the room.
          className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:w-[46rem] sm:max-w-[90vw]"
        >
          {selected && (
            <>
              <header className="shrink-0 border-b border-m-outline-variant px-6 pb-4 pt-6 pr-12">
                <SheetTitle className="text-title-medium text-m-on-surface">
                  {selected.parent_task_name}
                </SheetTitle>
                <p className="mt-1 text-label-medium text-m-on-surface-variant">
                  {selected.client?.name ?? "No client"} ·{" "}
                  {selected.requester?.full_name ?? "Unknown requester"} ·{" "}
                  {HOLDER_LABEL[holderOf(selected)]}
                </p>
              </header>
              <EscalationDetail
                row={selected}
                priorOverrunsThisMonth={priorOverruns}
                actions={
                  selected.status !== "pending_owner" ? (
                    <p className="text-body-small text-m-on-surface-variant">
                      {statusNote(selected)}
                    </p>
                  ) : compose ? (
                    <div className="space-y-2">
                      <label
                        htmlFor="escalation-compose"
                        className="block text-label-small text-m-on-surface-variant"
                      >
                        {compose.kind === "reject"
                          ? "Why is this being rejected? The requester sees this."
                          : `What do you need to know from ${selected.requester?.full_name ?? "the requester"}?`}
                      </label>
                      <Textarea
                        id="escalation-compose"
                        autoFocus
                        rows={3}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={
                          compose.kind === "reject" ? "Reason for rejection" : "Your question"
                        }
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyId === selected.id}
                          onClick={() => {
                            setCompose(null);
                            setDraft("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant={compose.kind === "reject" ? "destructive" : "default"}
                          disabled={busyId === selected.id}
                          onClick={() =>
                            compose.kind === "reject" ? reject(selected.id) : ask(selected.id)
                          }
                        >
                          {busyId === selected.id
                            ? compose.kind === "reject"
                              ? "Rejecting…"
                              : "Sending…"
                            : compose.kind === "reject"
                              ? "Confirm reject"
                              : "Send question"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2"
                        disabled={busyId === selected.id}
                        onClick={() => {
                          setCompose({ id: selected.id, kind: "ask" });
                          setDraft("");
                        }}
                      >
                        <HelpCircle className="h-4 w-4" />
                        Ask for info
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2"
                        disabled={busyId === selected.id}
                        onClick={() => {
                          setCompose({ id: selected.id, kind: "reject" });
                          setDraft("");
                        }}
                      >
                        <XCircle className="h-4 w-4" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        className="gap-2"
                        disabled={busyId === selected.id}
                        onClick={() => approve(selected.id)}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {busyId === selected.id ? "Approving…" : approveLabel(selected)}
                      </Button>
                    </div>
                  )
                }
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Set-toggle for the filter rail — same behaviour for both groups. */
function toggle<T>(value: T): (prev: Set<T>) => Set<T> {
  return (prev) => toggleInSet(prev, value);
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid place-items-center py-16">
      <div className="max-w-prose space-y-3 text-center">
        <p className="text-body-medium text-m-on-surface">{title}</p>
        <p className="text-body-small text-m-on-surface-variant">{body}</p>
        {action && <div className="flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

function statusNote(r: ExtensionRequestRow): string {
  if (r.status === "pending_admin") {
    return "Still with the admin — it reaches you only if they approve it.";
  }
  if (r.status === "needs_info") return "Waiting on the requester's answer.";
  if (r.status === "rejected") {
    return `Rejected${r.rejected_reason ? `: ${r.rejected_reason}` : "."}`;
  }
  return "Already decided.";
}

function approveLabel(r: ExtensionRequestRow): string {
  if (askedForPoints(r) && r.requested_due_date !== null) return "Approve points + date";
  if (r.requested_due_date !== null) return "Approve new date";
  return "Approve";
}

export default Escalations;
