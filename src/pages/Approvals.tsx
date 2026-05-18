import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import type { StaffBriefRow } from "@/types/staff-briefs";

type Joined = StaffBriefRow & {
  client: { id: string; name: string } | null;
  submitter: { id: string; full_name: string; email: string | null } | null;
};

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export function Approvals() {
  const [rows, setRows] = useState<Joined[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = async () => {
    const { data, error } = await supabase
      // @ts-expect-error: staff_briefs added by migration 0052
      .from("staff_briefs")
      .select(
        "*, client:clients(id, name), submitter:team_members!staff_briefs_submitter_id_fkey(id, full_name, email)",
      )
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`Could not load briefs: ${error.message}`);
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
      const res = await fetch(`${FUNCTIONS_BASE}/approve-staff-brief`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ staff_brief_id: id }),
      });
      const body = (await res.json()) as { error?: string; clickup_task_url?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Approve failed");
        return;
      }
      toast.success(
        body.clickup_task_url
          ? `Approved — ClickUp task created.`
          : "Approved.",
      );
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    if (!rejectReason.trim()) {
      toast.error("Provide a reason.");
      return;
    }
    setBusyId(id);
    try {
      const { error } = await supabase
        // @ts-expect-error: staff_briefs added by migration 0052
        .from("staff_briefs")
        .update({ status: "rejected", rejected_reason: rejectReason.trim() })
        .eq("id", id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Rejected.");
      setRejectingId(null);
      setRejectReason("");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (rows === null) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const pending = rows.filter((r) => r.status === "pending_approval");
  const recent = rows
    .filter((r) => r.status !== "pending_approval")
    .slice(0, 10);

  return (
    <div className="space-y-8 p-6">
      <section>
        <header className="mb-4 flex items-baseline justify-between">
          <h1 className="text-headline-small text-m-on-surface">Approvals</h1>
          <p className="text-body-small text-m-on-surface-variant">
            {pending.length} pending
          </p>
        </header>

        {pending.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-body-medium text-m-on-surface-variant">
              No pending briefs. ✨
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {pending.map((row) => (
              <li key={row.id}>
                <PendingCard
                  row={row}
                  busy={busyId === row.id}
                  rejecting={rejectingId === row.id}
                  rejectReason={rejectReason}
                  setRejectReason={setRejectReason}
                  onApprove={() => approve(row.id)}
                  onRejectStart={() => {
                    setRejectingId(row.id);
                    setRejectReason("");
                  }}
                  onRejectCancel={() => {
                    setRejectingId(null);
                    setRejectReason("");
                  }}
                  onRejectConfirm={() => reject(row.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-title-small text-m-on-surface-variant">
            Recent decisions
          </h2>
          <ul className="space-y-2">
            {recent.map((row) => (
              <li key={row.id}>
                <ResolvedRow row={row} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PendingCard({
  row,
  busy,
  rejecting,
  rejectReason,
  setRejectReason,
  onApprove,
  onRejectStart,
  onRejectCancel,
  onRejectConfirm,
}: {
  row: Joined;
  busy: boolean;
  rejecting: boolean;
  rejectReason: string;
  setRejectReason: (v: string) => void;
  onApprove: () => void;
  onRejectStart: () => void;
  onRejectCancel: () => void;
  onRejectConfirm: () => void;
}) {
  return (
    <Card className="shadow-elev-1">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-title-medium">{row.task_name}</CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-label-small text-m-on-surface-variant">
              <span>{row.submitter?.full_name ?? "Unknown"}</span>
              <span>·</span>
              <span>{row.client?.name ?? "Unknown client"}</span>
              <span>·</span>
              <span>{row.clickup_list_name}</span>
              <span>·</span>
              <span>{row.sprint_points} pts</span>
              {row.is_internal && (
                <>
                  <span>·</span>
                  <Badge variant="secondary">Internal</Badge>
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
        <div className="grid gap-4 text-body-small md:grid-cols-3">
          <AnswerBlock label="Goal" value={row.goal} />
          <AnswerBlock label="Success" value={row.success_criteria} />
          <AnswerBlock label="Measurable" value={row.measurable_outcome} />
        </div>

        {rejecting ? (
          <div className="space-y-2">
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (will be visible to the submitter)"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onRejectCancel} disabled={busy}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={onRejectConfirm} disabled={busy}>
                Confirm reject
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onRejectStart} disabled={busy} className="gap-2">
              <XCircle className="h-4 w-4" />
              Reject
            </Button>
            <Button onClick={onApprove} disabled={busy} className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {busy ? "Approving…" : "Approve & push to ClickUp"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResolvedRow({ row }: { row: Joined }) {
  const isApproved = row.status === "approved";
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-m-outline-variant bg-m-surface px-4 py-2">
      <div className="min-w-0 space-y-0.5">
        <div className="truncate text-body-medium text-m-on-surface">{row.task_name}</div>
        <div className="text-label-small text-m-on-surface-variant">
          {row.submitter?.full_name ?? "—"} · {row.client?.name ?? "—"} · {row.sprint_points} pts
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant={isApproved ? "default" : "destructive"}>
          {isApproved ? "Approved" : "Rejected"}
        </Badge>
        {row.clickup_task_url && (
          <a
            href={row.clickup_task_url}
            target="_blank"
            rel="noreferrer"
            className="text-label-small text-m-primary inline-flex items-center gap-1 hover:underline"
          >
            ClickUp <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function AnswerBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-label-small text-m-on-surface-variant">{label}</div>
      <p className="text-body-small text-m-on-surface whitespace-pre-wrap">{value}</p>
    </div>
  );
}

export default Approvals;
