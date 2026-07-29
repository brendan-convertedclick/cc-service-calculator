import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, HelpCircle, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { askForInfo } from "@/lib/extension-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EscalationRail, type RailGroup, type RailRow } from "@/components/approvals/EscalationRail";
import { EscalationDetail } from "@/components/approvals/EscalationDetail";
import type { ExtensionRequestRow } from "@/types/extension-requests";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Owner escalations, laid out as a queue and one decision.
 *
 * The rail answers "does this need me?" by grouping on who holds the request;
 * the pane answers everything else in a fixed order (see EscalationDetail).
 * Only `status='pending_owner'` rows are actionable — nothing reaches this page
 * without passing the admin leg first.
 */
export function Escalations() {
  const { currentUserId } = useAuth();
  const [rows, setRows] = useState<RailRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ id: string; kind: "reject" | "ask" } | null>(null);
  const [draft, setDraft] = useState("");
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
    setRows((data ?? []) as unknown as RailRow[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo<RailGroup[]>(() => {
    const all = rows ?? [];
    const by = (s: string) => all.filter((r) => r.status === s);
    return [
      { key: "owner", label: "Needs you", rows: by("pending_owner"), actionable: true },
      { key: "admin", label: "With admin", rows: by("pending_admin"), actionable: false },
      { key: "info", label: "Waiting on requester", rows: by("needs_info"), actionable: false },
      {
        key: "done",
        label: "Decided",
        rows: all
          .filter((r) => ["approved", "rejected", "auto_approved"].includes(r.status))
          .slice(0, 10),
        actionable: false,
      },
    ];
  }, [rows]);

  const pending = groups[0].rows;

  const select = useCallback(
    (id: string) => {
      setCompose(null);
      setDraft("");
      setParams({ id }, { replace: true });
    },
    [setParams],
  );

  // Land on the first thing that needs a decision, and follow the queue as it
  // empties rather than stranding the pane on a row that's just been actioned.
  useEffect(() => {
    if (rows === null) return;
    if (rows.some((r) => r.id === selectedId)) return;
    const next = pending[0]?.id ?? rows[0]?.id ?? null;
    setParams(next ? { id: next } : {}, { replace: true });
  }, [rows, selectedId, pending, setParams]);

  const selected = (rows ?? []).find((r) => r.id === selectedId) ?? null;

  /** Overruns already raised for this client this month, excluding this one. */
  const priorOverruns = useMemo(() => {
    if (!selected || !rows) return 0;
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return rows.filter(
      (r) =>
        r.id !== selected.id &&
        r.client_id === selected.client_id &&
        r.extra_points !== null &&
        r.status !== "rejected" &&
        new Date(r.created_at) >= start,
    ).length;
  }, [rows, selected]);

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${FUNCTIONS_BASE}/approve-extension-request`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ extension_request_id: id }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) return toast.error(body.error ?? "Approve failed");
      toast.success("Approved.");
      await load();
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
      setCompose(null);
      setDraft("");
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
      setCompose(null);
      setDraft("");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (rows === null) {
    return (
      <div className="flex flex-col md:h-full md:flex-row">
        <aside className="w-full shrink-0 space-y-3 border-b border-m-outline-variant p-4 md:w-56 md:overflow-y-auto md:border-b-0 md:border-r">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </aside>
        <div className="min-w-0 flex-1 p-6 md:overflow-y-auto">
          <Skeleton className="mb-6 h-8 w-48" />
          <Skeleton className="h-24 w-full max-w-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:h-full md:flex-row">
      {/* Standard left rail: same width, border and scroll behaviour as every
          other filtered page. Padding is vertical only so a selected row can
          bleed to both edges — this rail selects, it doesn't filter. */}
      <aside className="w-full shrink-0 border-b border-m-outline-variant py-2 md:w-56 md:overflow-y-auto md:border-b-0 md:border-r">
        <EscalationRail groups={groups} selectedId={selectedId} onSelect={select} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:overflow-y-auto">
        <header className="flex items-start justify-between gap-3 px-6 pt-6">
          <div>
            <h1 className="text-headline-medium text-m-on-surface">Escalations</h1>
            <p className="mt-1 text-body-medium text-m-on-surface-variant">
              {pending.length === 0
                ? "Nothing is waiting on your decision."
                : `${pending.length} ${pending.length === 1 ? "request needs" : "requests need"} your decision.`}
            </p>
          </div>
        </header>

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
      ) : !selected ? (
        <Empty
          title="Nothing needs you right now."
          body="Requests land here only after an admin has approved them and the size of the ask needs an owner's call. Smaller ones never reach this page."
        />
      ) : (
        <EscalationDetail
          row={selected}
          priorOverrunsThisMonth={priorOverruns}
          actions={
            selected.status !== "pending_owner" ? (
              <p className="text-body-small text-m-on-surface-variant">{statusNote(selected)}</p>
            ) : compose ? (
              <div className="max-w-2xl space-y-2">
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
                  placeholder={compose.kind === "reject" ? "Reason for rejection" : "Your question"}
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
      )}
      </div>
    </div>
  );
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
    <div className="grid flex-1 place-items-center p-6">
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
  if (r.extra_points !== null && r.requested_due_date !== null) return "Approve points + date";
  if (r.requested_due_date !== null) return "Approve new date";
  return "Approve";
}

export default Escalations;
