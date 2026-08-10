import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { callEdgeFn } from "@/lib/edge";
import { errorMessage } from "@/lib/utils";
import { notifyExtension } from "@/lib/extension-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { askedForPoints, type ExtensionRequestRow, type ExtensionStatus } from "@/types/extension-requests";

type Row = ExtensionRequestRow & { client: { name: string } | null };

const STATUS_LABEL: Record<ExtensionStatus, string> = {
  auto_approved: "auto-approved",
  pending_admin: "with admin",
  pending_owner: "with owner",
  needs_info: "needs your answer",
  approved: "approved",
  rejected: "rejected",
};

function statusVariant(status: ExtensionStatus) {
  if (status === "approved" || status === "auto_approved") return "success" as const;
  if (status === "rejected") return "destructive" as const;
  if (status === "needs_info") return "warning" as const;
  return "muted" as const;
}

/**
 * The requester's own view of their extension requests — mainly so they can
 * answer an approver's question and push the request back into the queue.
 */
export function MyRequestsList() {
  const { currentUserId } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUserId) {
      setRows([]);
      return;
    }
    const { data, error } = await supabase
      .from("extension_requests")
      .select("*, client:clients(name)")
      .eq("requester_id", currentUserId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      toast.error(`Could not load your requests: ${error.message}`);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as Row[]);
  }, [currentUserId]);

  useEffect(() => {
    load();
  }, [load]);

  const respond = async (id: string) => {
    const response = (answers[id] ?? "").trim();
    if (!response) return toast.error("Write an answer first.");
    setBusyId(id);
    try {
      const body = await callEdgeFn<{ status?: string }>("respond-to-info-request", {
        extension_request_id: id,
        response,
      });
      toast.success(
        body.status === "pending_owner" ? "Sent — back with the owner." : "Sent — back with the admin.",
      );
      setAnswers((a) => ({ ...a, [id]: "" }));
      notifyExtension(id);
      await load();
    } catch (e) {
      toast.error(`Could not send your answer: ${errorMessage(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  if (!currentUserId) {
    return (
      <p className="text-body-small text-m-on-surface-variant">
        Sign in with your own staff account to see your requests.
      </p>
    );
  }
  if (rows === null) return <Skeleton className="h-24 w-full" />;
  if (rows.length === 0) {
    return <p className="text-body-small text-m-on-surface-variant">No requests yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id}>
          <Card className={row.status === "needs_info" ? "border-m-primary shadow-elev-1" : ""}>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="text-body-medium text-m-on-surface">{row.parent_task_name}</div>
                  <div className="text-label-small text-m-on-surface-variant">
                    {row.client?.name ?? "—"} · {requestSummary(row)} ·{" "}
                    {new Date(row.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(row.status)}>{STATUS_LABEL[row.status]}</Badge>
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
              </div>

              {row.rejected_reason && (
                <p className="text-body-small text-m-on-surface-variant whitespace-pre-wrap">
                  <span className="text-m-error">Rejected: </span>
                  {row.rejected_reason}
                </p>
              )}

              {row.status === "needs_info" && (
                <div className="space-y-2 rounded-lg bg-m-surface-container-low p-3">
                  <div className="text-label-small text-m-on-surface-variant">
                    An approver asked:
                  </div>
                  <p className="text-body-medium text-m-on-surface whitespace-pre-wrap">
                    {row.info_request}
                  </p>
                  <Textarea
                    value={answers[row.id] ?? ""}
                    onChange={(e) => setAnswers((a) => ({ ...a, [row.id]: e.target.value }))}
                    rows={3}
                    placeholder="Your answer — this puts the request back in the queue."
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => respond(row.id)}
                      disabled={busyId === row.id}
                      className="gap-2"
                    >
                      <Send className="h-4 w-4" />
                      {busyId === row.id ? "Sending…" : "Send answer"}
                    </Button>
                  </div>
                </div>
              )}

              {row.status !== "needs_info" && row.info_response && (
                <p className="text-body-small text-m-on-surface-variant whitespace-pre-wrap">
                  <span className="text-m-on-surface">Your answer: </span>
                  {row.info_response}
                </p>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function requestSummary(r: Row): string {
  const parts: string[] = [];
  if (askedForPoints(r)) parts.push(`+${r.extra_points}pt`);
  if (r.requested_due_date !== null) parts.push(`due → ${r.requested_due_date}`);
  return parts.join(" · ") || "—";
}
