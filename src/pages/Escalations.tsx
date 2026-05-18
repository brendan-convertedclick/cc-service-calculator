import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExtensionRequestRow } from "@/types/extension-requests";

type Joined = ExtensionRequestRow & {
  client: { id: string; name: string } | null;
  requester: { id: string; full_name: string; email: string | null } | null;
};

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Owner-only escalations queue. Lists extension requests with tier='owner'
 * that are awaiting decision. Approve creates the ClickUp subtask;
 * reject closes the request with a reason.
 */
export function Escalations() {
  const [rows, setRows] = useState<Joined[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = async () => {
    const { data, error } = await supabase
      // @ts-expect-error extension_requests added by migration 0053
      .from("extension_requests")
      .select(
        "*, client:clients(id, name), requester:team_members!extension_requests_requester_id_fkey(id, full_name, email)",
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
      const { error } = await supabase
        // @ts-expect-error extension_requests added by migration 0053
        .from("extension_requests")
        .update({ status: "rejected", rejected_reason: reason.trim() })
        .eq("id", id);
      if (error) return toast.error(error.message);
      toast.success("Rejected.");
      setRejectingId(null);
      setReason("");
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
  const recent = rows.filter((r) => r.status !== "pending_owner").slice(0, 10);

  return (
    <div className="space-y-8 p-6">
      <section>
        <header className="mb-4 flex items-baseline justify-between">
          <h1 className="text-headline-small text-m-on-surface">Escalations</h1>
          <p className="text-body-small text-m-on-surface-variant">
            {pending.length} awaiting owner
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
                          <span>·</span>
                          <span>
                            +{row.extra_points}pt on {row.original_points}pt
                          </span>
                          <Badge variant="destructive" className="ml-1">
                            +{row.delta_pct}% · owner
                          </Badge>
                        </div>
                      </div>
                      <div className="text-label-small text-m-on-surface-variant whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString()}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-body-medium text-m-on-surface whitespace-pre-wrap">
                      {row.reason}
                    </p>
                    {rejectingId === row.id ? (
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
                          {busyId === row.id ? "Approving…" : "Approve & push subtask"}
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
                    {row.requester?.full_name ?? "—"} · +{row.extra_points}pt
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

export default Escalations;
