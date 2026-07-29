import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, HelpCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { askForInfo } from "@/lib/extension-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { RequestContext } from "@/components/approvals/RequestContext";
import type { ExtensionRequestRow } from "@/types/extension-requests";

type Joined = ExtensionRequestRow & {
  client: { id: string; name: string } | null;
  requester: { id: string; full_name: string; email: string | null } | null;
  admin_approver: { id: string; full_name: string } | null;
};

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Owner-only escalations queue. Only shows owner-tier requests the admin has
 * already signed off (status='pending_owner') — nothing reaches this page
 * without passing the admin leg first. Approve creates the ClickUp subtask,
 * reject closes it with a reason, and "Ask for info" bounces it back to the
 * requester without losing the admin sign-off.
 */
export function Escalations() {
  const { currentUserId } = useAuth();
  const [rows, setRows] = useState<Joined[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [askingId, setAskingId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");

  const load = async () => {
    const { data, error } = await supabase
      .from("extension_requests")
      .select(
        "*, client:clients(id, name), requester:team_members!extension_requests_requester_id_fkey(id, full_name, email), admin_approver:team_members!extension_requests_admin_approver_id_fkey(id, full_name)",
      )
      .eq("tier", "owner")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`Could not load escalations: ${error.message}`);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as Joined[]);
  };
  useEffect(() => {
    load();
  }, []);

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
      if (!res.ok) {
        toast.error(body.error ?? "Approve failed");
        return;
      }
      toast.success("Approved — subtask created.");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    if (!reason.trim()) return toast.error("Reason required.");
    setBusyId(id);
    try {
      const { data, error } = await supabase
        .from("extension_requests")
        .update({ status: "rejected", rejected_reason: reason.trim() })
        .eq("id", id)
        .select("id");
      if (error) return toast.error(error.message);
      if (!data || data.length === 0) return toast.error("Not permitted to update this request.");
      toast.success("Rejected.");
      setRejectingId(null);
      setReason("");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const ask = async (id: string) => {
    if (!question.trim()) return toast.error("Question required.");
    setBusyId(id);
    try {
      const err = await askForInfo(id, question, currentUserId);
      if (err) return toast.error(err);
      toast.success("Sent back to the requester.");
      setAskingId(null);
      setQuestion("");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (rows === null) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const pending = rows.filter((r) => r.status === "pending_owner");
  const awaitingInfo = rows.filter((r) => r.status === "needs_info");
  const inAdminLeg = rows.filter((r) => r.status === "pending_admin");
  const recent = rows
    .filter((r) => !["pending_owner", "needs_info", "pending_admin"].includes(r.status))
    .slice(0, 10);

  return (
    <div className="space-y-8 p-6">
      <section>
        <header className="mb-4 flex items-baseline justify-between">
          <h1 className="text-headline-small text-m-on-surface">Escalations</h1>
          <p className="text-body-small text-m-on-surface-variant">
            {pending.length} awaiting owner
            {inAdminLeg.length > 0 && ` · ${inAdminLeg.length} still with admin`}
            {awaitingInfo.length > 0 && ` · ${awaitingInfo.length} awaiting requester`}
          </p>
        </header>

        {pending.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-body-medium text-m-on-surface-variant">
              No owner escalations. ✨
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {pending.map((row) => (
              <li key={row.id}>
                <Card className="shadow-elev-1">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <CardTitle className="text-title-medium">
                          {row.parent_task_name}
                        </CardTitle>
                        <div className="flex flex-wrap items-center gap-2 text-label-small text-m-on-surface-variant">
                          <span>{row.requester?.full_name ?? "—"}</span>
                          <span>·</span>
                          <span>{row.client?.name ?? "—"}</span>
                          {row.extra_points !== null && (
                            <>
                              <span>·</span>
                              <span>
                                +{row.extra_points}pt on {row.original_points}pt
                              </span>
                              <Badge variant="destructive" className="ml-1">
                                +{row.delta_pct}% · owner
                              </Badge>
                            </>
                          )}
                          {row.requested_due_date !== null && (
                            <>
                              <span>·</span>
                              <span>due {row.original_due_date ?? "—"} → {row.requested_due_date}</span>
                              <Badge variant="destructive" className="ml-1">owner</Badge>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="text-label-small text-m-on-surface-variant whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString()}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {row.admin_approved_at && (
                      <div className="text-label-small text-m-on-surface-variant">
                        Approved by {row.admin_approver?.full_name ?? "admin"} on{" "}
                        {new Date(row.admin_approved_at).toLocaleString()} — escalated to you.
                      </div>
                    )}

                    <RequestContext taskId={row.parent_clickup_task_id} requestedPoints={row.extra_points} />

                    {row.reason && (
                      <Field label="Reason for extra points">{row.reason}</Field>
                    )}
                    {row.due_date_reason && (
                      <Field label="Reason for due-date push">{row.due_date_reason}</Field>
                    )}
                    {row.info_request && (
                      <Field label={`Question asked${row.info_requested_at ? ` on ${new Date(row.info_requested_at).toLocaleDateString()}` : ""}`}>
                        {row.info_request}
                      </Field>
                    )}
                    {row.info_response && (
                      <Field label="Requester's answer">{row.info_response}</Field>
                    )}

                    {askingId === row.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          rows={3}
                          placeholder="What do you need to know before deciding?"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setAskingId(null);
                              setQuestion("");
                            }}
                            disabled={busyId === row.id}
                          >
                            Cancel
                          </Button>
                          <Button size="sm" onClick={() => ask(row.id)} disabled={busyId === row.id}>
                            Send question
                          </Button>
                        </div>
                      </div>
                    ) : rejectingId === row.id ? (
                      <div className="space-y-2">
                        <Textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          rows={3}
                          placeholder="Reason for rejection"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setRejectingId(null);
                              setReason("");
                            }}
                            disabled={busyId === row.id}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => reject(row.id)}
                            disabled={busyId === row.id}
                          >
                            Confirm reject
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAskingId(row.id);
                            setQuestion("");
                          }}
                          disabled={busyId === row.id}
                          className="gap-2"
                        >
                          <HelpCircle className="h-4 w-4" />
                          Ask for info
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRejectingId(row.id);
                            setReason("");
                          }}
                          disabled={busyId === row.id}
                          className="gap-2"
                        >
                          <XCircle className="h-4 w-4" />
                          Reject
                        </Button>
                        <Button
                          onClick={() => approve(row.id)}
                          disabled={busyId === row.id}
                          className="gap-2"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {busyId === row.id ? "Approving…" : approveLabel(row)}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(awaitingInfo.length > 0 || inAdminLeg.length > 0) && (
        <section>
          <h2 className="mb-3 text-title-small text-m-on-surface-variant">
            In flight elsewhere
          </h2>
          <ul className="space-y-2">
            {[...inAdminLeg, ...awaitingInfo].map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-md border border-m-outline-variant bg-m-surface px-4 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-body-medium">{row.parent_task_name}</div>
                  <div className="text-label-small text-m-on-surface-variant">
                    {row.requester?.full_name ?? "—"} · {extensionSubtitle(row)}
                    {row.status === "needs_info" && row.info_request && ` · asked: ${row.info_request}`}
                  </div>
                </div>
                <Badge variant="muted">
                  {row.status === "needs_info" ? "awaiting requester" : "with admin"}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-title-small text-m-on-surface-variant">
            Recent owner decisions
          </h2>
          <ul className="space-y-2">
            {recent.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-md border border-m-outline-variant bg-m-surface px-4 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-body-medium">{row.parent_task_name}</div>
                  <div className="text-label-small text-m-on-surface-variant">
                    {row.requester?.full_name ?? "—"} · {extensionSubtitle(row)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={row.status === "approved" ? "default" : "destructive"}>
                    {row.status}
                  </Badge>
                  {row.clickup_subtask_url && (
                    <a
                      href={row.clickup_subtask_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-label-small text-m-primary inline-flex items-center gap-1 hover:underline"
                    >
                      ClickUp <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-label-small text-m-on-surface-variant">{label}</div>
      <p className="text-body-medium text-m-on-surface whitespace-pre-wrap">{children}</p>
    </div>
  );
}

function extensionSubtitle(r: ExtensionRequestRow): string {
  const parts: string[] = [];
  if (r.extra_points !== null) parts.push(`+${r.extra_points}pt (${r.delta_pct}%)`);
  if (r.requested_due_date !== null) parts.push(`due → ${r.requested_due_date}`);
  return parts.join(" · ") || "—";
}

function approveLabel(r: ExtensionRequestRow): string {
  if (r.extra_points !== null && r.requested_due_date !== null) return "Approve & push subtask + due date";
  if (r.requested_due_date !== null) return "Approve & update due date";
  return "Approve & push subtask";
}

export default Escalations;
