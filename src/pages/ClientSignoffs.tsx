import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink, Handshake, Link2Off, MessageCircleQuestion, Wand2 } from "lucide-react";
import { DraftSignoffsDialog } from "@/components/signoffs/DraftSignoffsDialog";
import { AskQuestionDialog } from "@/components/signoffs/AskQuestionDialog";
import { LogAgreementDialog } from "@/components/signoffs/LogAgreementDialog";
import { WaitingTable } from "@/components/signoffs/WaitingTable";
import { RunwayChart } from "@/components/signoffs/RunwayChart";
import { TurnaroundStatement } from "@/components/signoffs/TurnaroundStatement";
import { EvidenceDialog } from "@/components/signoffs/EvidenceDialog";
import { ActivityPanel } from "@/components/signoffs/ActivityPanel";
import { useSignoffCandidates } from "@/hooks/useSignoffCandidates";
import { ClientReview } from "@/pages/ClientReview";
import { FilterGroup, FilterOption } from "@/components/filters/FilterRail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  daysWaiting,
  useClientSignoffs,
  useLiveLinkCounts,
  type SignoffRow,
} from "@/hooks/useClientSignoffs";
import { useClientWaiting } from "@/hooks/useClientWaiting";
import { TYPE_LABEL } from "@/lib/client-review";
import { errorMessage } from "@/lib/utils";

const STATE_LABEL: Record<string, string> = {
  pending: "Waiting on client",
  approved: "Approved",
  changes_requested: "Changes requested",
};

/**
 * The client's answer to a question and their sign-off on a deliverable are
 * the same DB state; the word for them is not. "Approved" over an answered
 * question reads as though we graded their reply.
 */
const SETTLED_LABEL: Record<string, string> = {
  brief: "Approved",
  question: "Answered",
  agreement: "Done",
};

function StateBadge({ row }: { row: SignoffRow }) {
  if (row.state === "approved") {
    return (
      <Badge className="bg-m-tertiary-container text-m-on-tertiary-container">
        {SETTLED_LABEL[row.item_type] ?? "Approved"}
      </Badge>
    );
  }
  if (row.state === "changes_requested") {
    return <Badge variant="outline">Back with us</Badge>;
  }
  return (
    <Badge className="bg-m-primary-container text-m-on-primary-container">
      {STATE_LABEL.pending}
    </Badge>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-ZA");
}

/** Open / Closed / Everything, for the task ledger. */
type Scope = "open" | "closed" | "all";

export function ClientSignoffs() {
  const { data: rows = [], isPending, isError, error } = useClientSignoffs();
  const { data: linkCounts = {} } = useLiveLinkCounts();
  const { data: waiting = [], isPending: waitingPending } = useClientWaiting();
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [agreementOpen, setAgreementOpen] = useState(false);
  // The decided row whose evidence is open. Null = closed.
  const [evidenceOf, setEvidenceOf] = useState<SignoffRow | null>(null);
  // Which item the client preview currently has selected. The activity column
  // beside it follows this, so clicking a task in that queue fills the card on
  // the right. Reset when the client changes — the old id belongs to nobody.
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("open");
  const { data: candidates = [] } = useSignoffCandidates();

  // The running clock. Half these numbers grow while the page is open, and a
  // "waiting on client" figure frozen at page load is the one thing that would
  // make people stop trusting it. One tick a minute is plenty — the underlying
  // sync is half-hourly.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // "Waiting on this client" has ONE definition and every count on the page
  // uses it: an undecided ask they owe us, or a task sitting in their court.
  // An agreement WE made is excluded — it is waiting on us.
  const isOnClient = (r: SignoffRow) => r.state === "pending" && r.owed_by === "client";

  // One entry per client that has ever been asked for anything, or has a task.
  const clients = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; waiting: number }>();
    const bump = (id: string, name: string, isWaiting: boolean) => {
      const entry = byId.get(id) ?? { id, name, waiting: 0 };
      if (isWaiting) entry.waiting += 1;
      byId.set(id, entry);
    };
    for (const r of rows) bump(r.client_id, r.client_name, isOnClient(r));
    for (const t of waiting) bump(t.client_id, t.client_name, t.court === "client");
    return [...byId.values()].sort(
      (a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name),
    );
  }, [rows, waiting]);

  const q = search.trim().toLowerCase();

  const visible = useMemo(() => {
    return rows
      .filter((r) => (clientId ? r.client_id === clientId : true))
      .filter(
        (r) =>
          !q ||
          r.client_title.toLowerCase().includes(q) ||
          r.client_name.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // Longest-waiting first — the whole point of the page.
        const aw = daysWaiting(a);
        const bw = daysWaiting(b);
        if (aw !== bw) return bw - aw;
        if (a.state !== b.state) return a.state === "pending" ? -1 : 1;
        return b.created_at.localeCompare(a.created_at);
      });
  }, [rows, clientId, q]);

  const visibleTasks = useMemo(
    () =>
      waiting
        .filter((t) => (clientId ? t.client_id === clientId : true))
        .filter(
          (t) =>
            !q || t.title.toLowerCase().includes(q) || t.client_name.toLowerCase().includes(q),
        )
        .filter((t) =>
          scope === "all" ? true : scope === "closed" ? t.court === "done" : t.court !== "done",
        ),
    [waiting, clientId, q, scope],
  );

  const previewItem = rows.find((r) => r.id === previewItemId) ?? null;

  // Scoped to the picked client, so the tab labels and the summary line
  // describe what is actually in front of you. A number that stays at the
  // agency total while the page shows one client is a number nobody trusts.
  const selected = clients.find((c) => c.id === clientId) ?? null;
  const inScope = clientId ? rows.filter((r) => r.client_id === clientId) : rows;
  const pending = inScope.filter(isOnClient);
  const worst = pending.reduce((m, r) => Math.max(m, daysWaiting(r)), 0);
  const selectedHasLink = selected ? (linkCounts[selected.id] ?? 0) > 0 : true;
  const onClientNow = (clientId ? waiting.filter((t) => t.client_id === clientId) : waiting).filter(
    (t) => t.court === "client",
  ).length;
  const owedByUs = inScope.filter((r) => r.state === "pending" && r.owed_by === "us").length;

  return (
    <div className="flex h-full">
      <aside className="w-64 shrink-0 border-r border-m-outline-variant">
        <div className="p-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sign-offs…"
            aria-label="Search sign-offs"
          />
        </div>
        <div className="space-y-4 border-t border-m-outline-variant p-3">
          <FilterGroup label="Client">
            <FilterOption
              label="All clients"
              count={clients.reduce((n, c) => n + c.waiting, 0)}
              active={clientId === null}
              onToggle={() => {
                setClientId(null);
                setPreviewItemId(null);
              }}
            />
            {clients.map((c) => (
              <FilterOption
                key={c.id}
                label={c.name}
                count={c.waiting}
                active={clientId === c.id}
                onToggle={() => {
                  setClientId(clientId === c.id ? null : c.id);
                  setPreviewItemId(null);
                }}
              />
            ))}
          </FilterGroup>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="border-b border-m-outline-variant px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-headline-small text-m-on-surface">Client sign-offs</h1>
            <div className="flex flex-wrap gap-2">
              {/* Both of these are addressed to ONE company, so they need a
                  client picked. Rendered disabled rather than hidden — the
                  capability should be discoverable from the empty state. */}
              <Button
                variant="outline"
                size="sm"
                disabled={!selected}
                title={selected ? undefined : "Pick a client first"}
                onClick={() => setAskOpen(true)}
              >
                <MessageCircleQuestion className="mr-1.5 h-3.5 w-3.5" />
                Ask a question
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!selected}
                title={selected ? undefined : "Pick a client first"}
                onClick={() => setAgreementOpen(true)}
              >
                <Handshake className="mr-1.5 h-3.5 w-3.5" />
                Record an agreement
              </Button>
              {candidates.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setDraftOpen(true)}>
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  Draft from ClickUp ({candidates.length})
                </Button>
              )}
            </div>
          </div>
          <p className="mt-1 text-body-medium text-m-on-surface-variant">
            {pending.length === 0
              ? `Nothing is waiting on ${selected ? selected.name : "a client"} right now.`
              : `${pending.length} ${pending.length === 1 ? "item is" : "items are"} waiting on ${
                  selected ? selected.name : "a client"
                }${worst > 0 ? ` — the oldest is ${worst} days past its date` : ""}.`}
            {owedByUs > 0
              ? ` ${owedByUs} ${owedByUs === 1 ? "thing is" : "things are"} waiting on us.`
              : ""}
          </p>
        </div>

        {isError ? (
          <p className="p-6 text-body-medium text-m-error">
            Could not load sign-offs: {errorMessage(error)}
          </p>
        ) : isPending ? (
          <div className="flex flex-col gap-2 p-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-md" />
            ))}
          </div>
        ) : (
          <Tabs defaultValue="asks">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-m-outline-variant px-6 pt-3">
              {/* Sign-offs & asks leads and opens by default: it is what
                  someone came here to act on. "Who's holding it up" is the
                  evidence you reach for in a meeting — a second question,
                  not the first one. */}
              <TabsList>
                <TabsTrigger value="asks">Sign-offs &amp; asks ({pending.length})</TabsTrigger>
                <TabsTrigger value="waiting">Who&apos;s holding it up ({onClientNow})</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="waiting">
              <div className="flex gap-1.5 border-b border-m-outline-variant px-6 py-3">
                {(["open", "closed", "all"] as Scope[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={
                      s === scope
                        ? "rounded-full bg-m-primary-container px-3 py-1 text-label-large text-m-on-primary-container"
                        : "rounded-full px-3 py-1 text-label-large text-m-on-surface-variant hover:bg-m-surface-container"
                    }
                  >
                    {s === "open" ? "Open" : s === "closed" ? "Closed" : "Everything"}
                  </button>
                ))}
              </div>
              {waitingPending ? (
                <div className="flex flex-col gap-2 p-6">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 rounded-md" />
                  ))}
                </div>
              ) : (
                <>
                  {/* The sentence, then the picture, then the ledger. A total
                      for six tasks cannot be acted on, so the runway chart
                      sits between the summary and the rows and says which
                      one. */}
                  <TurnaroundStatement
                    tasks={visibleTasks}
                    now={now}
                    clientName={selected?.name ?? null}
                  />
                  <RunwayChart tasks={visibleTasks} now={now} />
                  <WaitingTable tasks={visibleTasks} now={now} />
                </>
              )}
            </TabsContent>

            <TabsContent value="asks">
              {selected ? (
                <div className="border-b border-m-outline-variant p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-title-medium text-m-on-surface">
                        What {selected.name} sees
                      </h2>
                      <p className="mt-0.5 text-body-small text-m-on-surface-variant">
                        The live page, rendered exactly as they get it. Pressing a button here
                        records nothing.
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/clients/${selected.id}`}>
                        Manage their link <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>

                  {!selectedHasLink && (
                    <div className="mb-4 flex items-start gap-2 rounded-lg border border-m-outline-variant bg-m-surface-container p-3">
                      <Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-m-on-surface-variant" />
                      <p className="text-body-small text-m-on-surface-variant">
                        {selected.name} has no live link, so they cannot reach this page yet.
                        Create one on their client page, or send them a question — that mints one.
                      </p>
                    </div>
                  )}

                  {/* Left: the client's own screen, rendered by the same component
                      they get — never a staff-only lookalike. Right: OUR column,
                      outside that frame because none of it is theirs to see.
                      Clicking a task in their queue fills the card on the right. */}
                  <div className="flex flex-col gap-4 xl:flex-row">
                    <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-m-outline-variant bg-m-background shadow-elev-1">
                      <div className="h-[720px] overflow-hidden">
                        <ClientReview
                          previewClientId={selected.id}
                          onSelectedItemChange={setPreviewItemId}
                        />
                      </div>
                    </div>
                    <aside className="h-[720px] shrink-0 overflow-hidden rounded-xl border border-m-outline-variant bg-m-surface shadow-elev-1 xl:w-[26rem]">
                      <ActivityPanel
                        approvalId={previewItem?.id}
                        clientId={previewItem?.client_id ?? selected.id}
                        clientName={selected.name}
                        title={previewItem?.client_title ?? ""}
                        state={previewItem?.state}
                        hasItems={inScope.length > 0}
                        onAskQuestion={() => setAskOpen(true)}
                        onRecordAgreement={() => setAgreementOpen(true)}
                        ourAgreement={
                          previewItem?.item_type === "agreement" &&
                          previewItem.owed_by === "us" &&
                          previewItem.state === "pending"
                            ? {
                                detail: previewItem.detail,
                                dueDate: previewItem.due_date,
                                briefId: previewItem.brief_id ?? null,
                              }
                            : null
                        }
                      />
                    </aside>
                  </div>
                </div>
              ) : null}

              {selected && visible.length > 0 ? (
                <h2 className="px-6 pb-2 pt-5 text-title-small text-m-on-surface">
                  {selected.name}&apos;s items, with our own columns
                </h2>
              ) : null}

              {visible.length === 0 ? (
                <div className="flex flex-col items-start gap-3 p-6">
                  <p className="text-body-medium text-m-on-surface-variant">
                    Nothing asked yet{selected ? ` of ${selected.name}` : ""}.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selected}
                      title={selected ? undefined : "Pick a client first"}
                      onClick={() => setAskOpen(true)}
                    >
                      <MessageCircleQuestion className="mr-1.5 h-3.5 w-3.5" />
                      Ask a question
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selected}
                      title={selected ? undefined : "Pick a client first"}
                      onClick={() => setAgreementOpen(true)}
                    >
                      <Handshake className="mr-1.5 h-3.5 w-3.5" />
                      Record an agreement
                    </Button>
                    {candidates.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => setDraftOpen(true)}>
                        <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                        Draft from ClickUp ({candidates.length})
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <table className="w-full text-body-medium">
                  <thead>
                    <tr className="border-b border-m-outline-variant text-label-medium text-m-on-surface-variant">
                      <th className="px-6 py-2 text-left font-medium">Client</th>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-left font-medium">Item</th>
                      <th className="px-3 py-2 text-left font-medium">State</th>
                      <th className="px-3 py-2 text-right font-medium">Waiting</th>
                      <th className="px-6 py-2 text-left font-medium">Answered by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r: SignoffRow) => {
                      const late = daysWaiting(r);
                      return (
                        <tr key={r.id} className="border-b border-m-outline-variant/60">
                          <td className="px-6 py-2.5">
                            <button
                              type="button"
                              onClick={() => setClientId(r.client_id)}
                              className="text-left text-m-primary hover:underline"
                            >
                              {r.client_name}
                            </button>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant="muted">{TYPE_LABEL[r.item_type]}</Badge>
                          </td>
                          <td className="px-3 py-2.5 text-m-on-surface">{r.client_title}</td>
                          <td className="px-3 py-2.5">
                            <StateBadge row={r} />
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {r.state !== "pending" ? (
                              <span className="text-m-on-surface-variant">—</span>
                            ) : late > 0 ? (
                              <span className="inline-flex items-center gap-1 text-m-error">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                {late}d
                              </span>
                            ) : (
                              <span className="text-m-on-surface-variant">on time</span>
                            )}
                          </td>
                          <td className="px-6 py-2.5 text-m-on-surface-variant">
                            {r.decided_by_name ? (
                              <button
                                type="button"
                                onClick={() => setEvidenceOf(r)}
                                className="text-left text-m-primary hover:underline"
                              >
                                {r.decided_by_name} · {fmtDate(r.decided_at)}
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <DraftSignoffsDialog open={draftOpen} onOpenChange={setDraftOpen} />
      <EvidenceDialog
        open={evidenceOf !== null}
        onOpenChange={(next) => {
          if (!next) setEvidenceOf(null);
        }}
        approvalId={evidenceOf?.id}
        title={evidenceOf?.client_title ?? ""}
      />
      {selected ? (
        <>
          <AskQuestionDialog
            open={askOpen}
            onOpenChange={setAskOpen}
            clientId={selected.id}
            clientName={selected.name}
          />
          <LogAgreementDialog
            open={agreementOpen}
            onOpenChange={setAgreementOpen}
            clientId={selected.id}
            clientName={selected.name}
          />
        </>
      ) : null}
    </div>
  );
}
