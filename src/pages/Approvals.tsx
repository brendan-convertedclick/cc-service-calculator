import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StaffBriefRow } from "@/types/staff-briefs";
import type { ExtensionRequestRow } from "@/types/extension-requests";

type BriefJoined = StaffBriefRow & {
  client: { id: string; name: string } | null;
  submitter: { id: string; full_name: string; email: string | null } | null;
};
type ExtJoined = ExtensionRequestRow & {
  client: { id: string; name: string } | null;
  requester: { id: string; full_name: string; email: string | null } | null;
};

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export function Approvals() {
  const [briefs, setBriefs] = useState<BriefJoined[] | null>(null);
  const [exts, setExts] = useState<ExtJoined[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const loadBriefs = async () => {
    const { data, error } = await supabase
      // @ts-expect-error staff_briefs added by migration 0052
      .from("staff_briefs")
      .select(
        "*, client:clients(id, name), submitter:team_members!staff_briefs_submitter_id_fkey(id, full_name, email)",
      )
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`Could not load briefs: ${error.message}`);
      setBriefs([]);
      return;
    }
    setBriefs((data ?? []) as unknown as BriefJoined[]);
  };
  const loadExts = async () => {
    const { data, error } = await supabase
      // @ts-expect-error extension_requests added by migration 0053
      .from("extension_requests")
      .select(
        "*, client:clients(id, name), requester:team_members!extension_requests_requester_id_fkey(id, full_name, email)",
      )
      .in("tier", ["auto", "admin"])
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`Could not load extensions: ${error.message}`);
      setExts([]);
      return;
    }
    setExts((data ?? []) as unknown as ExtJoined[]);
  };

  useEffect(() => {
    loadBriefs();
    loadExts();
  }, []);

  const approveBrief = async (id: string) => {
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
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "Approve failed");
        return;
      }
      toast.success("Approved — ClickUp task created.");
      await loadBriefs();
    } finally {
      setBusyId(null);
    }
  };

  const approveExt = async (id: string) => {
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
      await loadExts();
    } finally {
      setBusyId(null);
    }
  };

  const rejectBrief = async (id: string) => {
    if (!rejectReason.trim()) return toast.error("Reason required.");
    setBusyId(id);
    try {
      const { error } = await supabase
        // @ts-expect-error staff_briefs added by migration 0052
        .from("staff_briefs")
        .update({ status: "rejected", rejected_reason: rejectReason.trim() })
        .eq("id", id);
      if (error) return toast.error(error.message);
      toast.success("Rejected.");
      setRejectingId(null);
      setRejectReason("");
      await loadBriefs();
    } finally {
      setBusyId(null);
    }
  };
  const rejectExt = async (id: string) => {
    if (!rejectReason.trim()) return toast.error("Reason required.");
    setBusyId(id);
    try {
      const { error } = await supabase
        // @ts-expect-error extension_requests added by migration 0053
        .from("extension_requests")
        .update({ status: "rejected", rejected_reason: rejectReason.trim() })
        .eq("id", id);
      if (error) return toast.error(error.message);
      toast.success("Rejected.");
      setRejectingId(null);
      setRejectReason("");
      await loadExts();
    } finally {
      setBusyId(null);
    }
  };

  if (briefs === null || exts === null) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const pendingBriefs = briefs.filter((r) => r.status === "pending_approval");
  const pendingExts = exts.filter((r) => r.status === "pending_admin");

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-headline-small text-m-on-surface">Approvals</h1>
        <p className="text-body-small text-m-on-surface-variant">
          {pendingBriefs.length} briefs · {pendingExts.length} extensions
        </p>
      </header>

      <Tabs defaultValue="briefs" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="briefs">Briefs · {pendingBriefs.length}</TabsTrigger>
          <TabsTrigger value="extensions">Extensions · {pendingExts.length}</TabsTrigger>
        </TabsList>

        <TabsContent value="briefs" className="space-y-3">
          {pendingBriefs.length === 0 ? (
            <EmptyState label="No pending briefs." />
          ) : (
            pendingBriefs.map((row) => (
              <BriefCard
                key={row.id}
                row={row}
                busy={busyId === row.id}
                rejecting={rejectingId === row.id}
                rejectReason={rejectReason}
                setRejectReason={setRejectReason}
                onApprove={() => approveBrief(row.id)}
                onRejectStart={() => {
                  setRejectingId(row.id);
                  setRejectReason("");
                }}
                onRejectCancel={() => {
                  setRejectingId(null);
                  setRejectReason("");
                }}
                onRejectConfirm={() => rejectBrief(row.id)}
              />
            ))
          )}
          {briefs.filter((r) => r.status !== "pending_approval").slice(0, 8).length > 0 && (
            <RecentList
              title="Recent brief decisions"
              items={briefs
                .filter((r) => r.status !== "pending_approval")
                .slice(0, 8)
                .map((r) => ({
                  id: r.id,
                  title: r.task_name,
                  subtitle: `${r.submitter?.full_name ?? "—"} · ${r.client?.name ?? "—"} · ${r.sprint_points} pts`,
                  status: r.status,
                  url: r.clickup_task_url,
                }))}
            />
          )}
        </TabsContent>

        <TabsContent value="extensions" className="space-y-3">
          {pendingExts.length === 0 ? (
            <EmptyState label="No pending extensions." />
          ) : (
            pendingExts.map((row) => (
              <ExtCard
                key={row.id}
                row={row}
                busy={busyId === row.id}
                rejecting={rejectingId === row.id}
                rejectReason={rejectReason}
                setRejectReason={setRejectReason}
                onApprove={() => approveExt(row.id)}
                onRejectStart={() => {
                  setRejectingId(row.id);
                  setRejectReason("");
                }}
                onRejectCancel={() => {
                  setRejectingId(null);
                  setRejectReason("");
                }}
                onRejectConfirm={() => rejectExt(row.id)}
              />
            ))
          )}
          {exts.filter((r) => r.status !== "pending_admin").slice(0, 8).length > 0 && (
            <RecentList
              title="Recent extension activity"
              items={exts
                .filter((r) => r.status !== "pending_admin")
                .slice(0, 8)
                .map((r) => ({
                  id: r.id,
                  title: r.parent_task_name,
                  subtitle: `${r.requester?.full_name ?? "—"} · +${r.extra_points}pt (${r.delta_pct}%) · tier=${r.tier}`,
                  status: r.status,
                  url: r.clickup_subtask_url,
                }))}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 text-center text-body-medium text-m-on-surface-variant">
        {label}
      </CardContent>
    </Card>
  );
}

function BriefCard({
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
  row: BriefJoined;
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
          <Answer label="Goal" value={row.goal} />
          <Answer label="Success" value={row.success_criteria} />
          <Answer label="Measurable" value={row.measurable_outcome} />
        </div>
        {rejecting ? (
          <RejectBox
            value={rejectReason}
            onChange={setRejectReason}
            onCancel={onRejectCancel}
            onConfirm={onRejectConfirm}
            busy={busy}
          />
        ) : (
          <ActionRow
            onReject={onRejectStart}
            onApprove={onApprove}
            busy={busy}
            approveLabel="Approve & push to ClickUp"
          />
        )}
      </CardContent>
    </Card>
  );
}

function ExtCard({
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
  row: ExtJoined;
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
            <CardTitle className="text-title-medium">{row.parent_task_name}</CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-label-small text-m-on-surface-variant">
              <span>{row.requester?.full_name ?? "—"}</span>
              <span>·</span>
              <span>{row.client?.name ?? "—"}</span>
              <span>·</span>
              <span>+{row.extra_points}pt on {row.original_points}pt</span>
              <Badge variant="warning" className="ml-1">+{row.delta_pct}% · admin</Badge>
            </div>
          </div>
          <div className="text-label-small text-m-on-surface-variant whitespace-nowrap">
            {new Date(row.created_at).toLocaleString()}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-body-medium text-m-on-surface whitespace-pre-wrap">{row.reason}</p>
        {rejecting ? (
          <RejectBox
            value={rejectReason}
            onChange={setRejectReason}
            onCancel={onRejectCancel}
            onConfirm={onRejectConfirm}
            busy={busy}
          />
        ) : (
          <ActionRow
            onReject={onRejectStart}
            onApprove={onApprove}
            busy={busy}
            approveLabel="Approve & push subtask"
          />
        )}
      </CardContent>
    </Card>
  );
}

function Answer({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-label-small text-m-on-surface-variant">{label}</div>
      <p className="text-body-small text-m-on-surface whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function RejectBox({
  value,
  onChange,
  onCancel,
  onConfirm,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Reason for rejection (visible to submitter)"
        rows={3}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" onClick={onConfirm} disabled={busy}>
          Confirm reject
        </Button>
      </div>
    </div>
  );
}

function ActionRow({
  onReject,
  onApprove,
  busy,
  approveLabel,
}: {
  onReject: () => void;
  onApprove: () => void;
  busy: boolean;
  approveLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={onReject} disabled={busy} className="gap-2">
        <XCircle className="h-4 w-4" />
        Reject
      </Button>
      <Button onClick={onApprove} disabled={busy} className="gap-2">
        <CheckCircle2 className="h-4 w-4" />
        {busy ? "Approving…" : approveLabel}
      </Button>
    </div>
  );
}

function RecentList({
  title,
  items,
}: {
  title: string;
  items: Array<{
    id: string;
    title: string;
    subtitle: string;
    status: string;
    url: string | null;
  }>;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-title-small text-m-on-surface-variant">{title}</h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-md border border-m-outline-variant bg-m-surface px-4 py-2"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="truncate text-body-medium">{item.title}</div>
              <div className="text-label-small text-m-on-surface-variant">{item.subtitle}</div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={recentBadgeVariant(item.status)}>{item.status}</Badge>
              {item.url && (
                <a
                  href={item.url}
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
  );
}

function recentBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" | "muted" | "success" | "warning" {
  if (status === "approved" || status === "auto_approved") return "success";
  if (status === "rejected") return "destructive";
  return "muted";
}

export default Approvals;
