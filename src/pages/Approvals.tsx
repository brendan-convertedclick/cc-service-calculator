import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, HelpCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { fmtPtH } from "@/lib/sprint-points";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { callEdgeFn } from "@/lib/edge";
import { cn, errorMessage } from "@/lib/utils";
import { useRetainers } from "@/hooks/useRetainers";
import { askForInfo, notifyExtension, rejectRequest } from "@/lib/extension-actions";
import { RequestContext } from "@/components/approvals/RequestContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StaffBriefRow } from "@/types/staff-briefs";
import { askedForPoints, type ExtensionRequestRow } from "@/types/extension-requests";
import type { RevisionRequestRow } from "@/types/revision-requests";

type BriefJoined = StaffBriefRow & {
  client: { id: string; name: string } | null;
  submitter: { id: string; full_name: string; email: string | null } | null;
};
type ExtJoined = ExtensionRequestRow & {
  client: { id: string; name: string } | null;
  requester: { id: string; full_name: string; email: string | null } | null;
};
type RevJoined = RevisionRequestRow & {
  client: { id: string; name: string } | null;
  requester: { id: string; full_name: string; email: string | null } | null;
};

export function Approvals() {
  const { currentUserId } = useAuth();
  const [briefs, setBriefs] = useState<BriefJoined[] | null>(null);
  // Which retainer each pending brief is being allocated to. Held here rather
  // than in the card so a re-render mid-approval cannot lose the choice.
  const [briefProject, setBriefProject] = useState<Record<string, string | null>>({});
  const { data: allRetainers = [] } = useRetainers();
  const [exts, setExts] = useState<ExtJoined[] | null>(null);
  const [revs, setRevs] = useState<RevJoined[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [askingId, setAskingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const loadBriefs = async () => {
    const { data, error } = await supabase
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
      .from("extension_requests")
      .select(
        "*, client:clients(id, name), requester:team_members!extension_requests_requester_id_fkey(id, full_name, email)",
      )
      // No tier filter: owner-tier requests now enter here too (status
      // pending_admin) and are promoted to /escalations on admin approval.
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`Could not load extensions: ${error.message}`);
      setExts([]);
      return;
    }
    setExts((data ?? []) as unknown as ExtJoined[]);
  };
  const loadRevs = async () => {
    const { data, error } = await supabase
      .from("revision_requests")
      .select(
        "*, client:clients(id, name), requester:team_members!revision_requests_requester_id_fkey(id, full_name, email)",
      )
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`Could not load revisions: ${error.message}`);
      setRevs([]);
      return;
    }
    setRevs((data ?? []) as unknown as RevJoined[]);
  };

  useEffect(() => {
    loadBriefs();
    loadExts();
    loadRevs();
  }, []);

  const approveBrief = async (id: string, projectId: string | null) => {
    setBusyId(id);
    try {
      await callEdgeFn("approve-staff-brief", { staff_brief_id: id, project_id: projectId });
      toast.success("Approved — ClickUp task created.");
      await loadBriefs();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const approveExt = async (id: string) => {
    setBusyId(id);
    try {
      const body = await callEdgeFn<{ promoted?: boolean }>("approve-extension-request", {
        extension_request_id: id,
      });
      if (body.promoted) {
        // Owner-tier: nothing pushed to ClickUp yet, the owner signs off next.
        toast.success("Approved — escalated to the owner for final sign-off.");
        notifyExtension(id);
      } else {
        toast.success("Approved — subtask created.");
      }
      await loadExts();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const askExt = async (id: string) => {
    if (!rejectReason.trim()) return toast.error("Question required.");
    setBusyId(id);
    try {
      const err = await askForInfo(id, rejectReason, currentUserId);
      if (err) return toast.error(err);
      toast.success("Sent back to the requester.");
      setAskingId(null);
      setRejectReason("");
      await loadExts();
    } finally {
      setBusyId(null);
    }
  };

  const approveRev = async (id: string) => {
    setBusyId(id);
    try {
      await callEdgeFn("approve-revision-request", { revision_request_id: id });
      toast.success("Approved — new task created.");
      await loadRevs();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const rejectBrief = async (id: string) => {
    if (!rejectReason.trim()) return toast.error("Reason required.");
    setBusyId(id);
    try {
      const { error } = await supabase
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
      // Terminal by design: an admin reject never reaches the owner queue.
      const err = await rejectRequest(id, rejectReason, currentUserId);
      if (err) return toast.error(err);
      toast.success("Rejected.");
      setRejectingId(null);
      setRejectReason("");
      await loadExts();
    } finally {
      setBusyId(null);
    }
  };
  const rejectRev = async (id: string) => {
    if (!rejectReason.trim()) return toast.error("Reason required.");
    setBusyId(id);
    try {
      const { error } = await supabase
        .from("revision_requests")
        .update({ status: "rejected", rejected_reason: rejectReason.trim() })
        .eq("id", id);
      if (error) return toast.error(error.message);
      toast.success("Rejected.");
      setRejectingId(null);
      setRejectReason("");
      await loadRevs();
    } finally {
      setBusyId(null);
    }
  };

  if (briefs === null || exts === null || revs === null) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const pendingBriefs = briefs.filter((r) => r.status === "pending_approval");
  const pendingExts = exts.filter((r) => r.status === "pending_admin");
  const pendingRevs = revs.filter((r) => r.status === "pending_admin");

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-headline-small text-m-on-surface">Approvals</h1>
        <p className="text-body-small text-m-on-surface-variant">
          {pendingBriefs.length} briefs · {pendingExts.length} extensions · {pendingRevs.length} revisions
        </p>
      </header>

      <Tabs defaultValue="briefs" className="space-y-6">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="briefs">Briefs · {pendingBriefs.length}</TabsTrigger>
          <TabsTrigger value="extensions">Extensions · {pendingExts.length}</TabsTrigger>
          <TabsTrigger value="revisions">Revisions · {pendingRevs.length}</TabsTrigger>
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
                retainers={allRetainers}
                projectId={briefProject[row.id] ?? null}
                onProjectChange={(pid) => setBriefProject((m) => ({ ...m, [row.id]: pid }))}
                onApprove={() => approveBrief(row.id, briefProject[row.id] ?? null)}
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
                  subtitle: `${r.submitter?.full_name ?? "—"} · ${r.client?.name ?? "—"} · ${fmtPtH(r.sprint_points)}`,
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
                asking={askingId === row.id}
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
                onAskStart={() => {
                  setAskingId(row.id);
                  setRejectReason("");
                }}
                onAskCancel={() => {
                  setAskingId(null);
                  setRejectReason("");
                }}
                onAskConfirm={() => askExt(row.id)}
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
                  subtitle: `${r.requester?.full_name ?? "—"} · ${extensionSubtitle(r)} · tier=${r.tier}`,
                  status: r.status,
                  url: r.clickup_subtask_url,
                }))}
            />
          )}
        </TabsContent>

        <TabsContent value="revisions" className="space-y-3">
          {pendingRevs.length === 0 ? (
            <EmptyState label="No pending revisions." />
          ) : (
            pendingRevs.map((row) => (
              <RevCard
                key={row.id}
                row={row}
                busy={busyId === row.id}
                rejecting={rejectingId === row.id}
                rejectReason={rejectReason}
                setRejectReason={setRejectReason}
                onApprove={() => approveRev(row.id)}
                onRejectStart={() => {
                  setRejectingId(row.id);
                  setRejectReason("");
                }}
                onRejectCancel={() => {
                  setRejectingId(null);
                  setRejectReason("");
                }}
                onRejectConfirm={() => rejectRev(row.id)}
              />
            ))
          )}
          {revs.filter((r) => r.status !== "pending_admin").slice(0, 8).length > 0 && (
            <RecentList
              title="Recent revision activity"
              items={revs
                .filter((r) => r.status !== "pending_admin")
                .slice(0, 8)
                .map((r) => ({
                  id: r.id,
                  title: r.parent_task_name,
                  subtitle: `${r.requester?.full_name ?? "—"} · → ${r.revision_suffix}`,
                  status: r.status,
                  url: r.clickup_new_task_url,
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
  retainers,
  projectId,
  onProjectChange,
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
  retainers: { id: string; name: string; client_id: string | null; status: string }[];
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
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
              <span>{fmtPtH(row.sprint_points)}</span>
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
          <div className="space-y-2">
            {/* Enforced here, not on the staff form: the submitter rarely knows
                whether their task is covered by a retainer or is billable. */}
            {!row.is_internal && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label htmlFor={`alloc-${row.id}`} className="text-label-small text-m-on-surface-variant">
                  Delivered against
                </label>
                <select
                  id={`alloc-${row.id}`}
                  value={projectId ?? ""}
                  onChange={(e) => onProjectChange(e.target.value || null)}
                  className={cn(
                    "h-8 max-w-[18rem] rounded-md border bg-m-surface px-2 text-label-medium",
                    projectId ? "border-m-outline" : "border-m-error text-m-error",
                  )}
                >
                  <option value="">— pick a retainer</option>
                  {retainers
                    .filter((r) => r.status === "in_progress" && r.client_id === row.client?.id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                </select>
              </div>
            )}
            {!row.is_internal && !projectId && (
              <p className="text-right text-label-small text-m-error">
                Approving without one puts this work in no budget and on no invoice.
              </p>
            )}
            <ActionRow
              onReject={onRejectStart}
              onApprove={onApprove}
              busy={busy || (!row.is_internal && !projectId)}
              approveLabel="Approve & push to ClickUp"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ExtCard({
  row,
  busy,
  rejecting,
  asking,
  rejectReason,
  setRejectReason,
  onApprove,
  onRejectStart,
  onRejectCancel,
  onRejectConfirm,
  onAskStart,
  onAskCancel,
  onAskConfirm,
}: {
  row: ExtJoined;
  busy: boolean;
  rejecting: boolean;
  asking: boolean;
  rejectReason: string;
  setRejectReason: (v: string) => void;
  onApprove: () => void;
  onRejectStart: () => void;
  onRejectCancel: () => void;
  onRejectConfirm: () => void;
  onAskStart: () => void;
  onAskCancel: () => void;
  onAskConfirm: () => void;
}) {
  // Owner-tier rows stop here first: approving hands them on rather than
  // pushing to ClickUp. A reject here is terminal — it never reaches the owner.
  const isEscalation = row.tier === "owner";
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
              {askedForPoints(row) && (
                <>
                  <span>·</span>
                  <span>+{fmtPtH(row.extra_points)} on {fmtPtH(row.original_points)}</span>
                  <Badge variant={isEscalation ? "destructive" : "warning"} className="ml-1">
                    +{row.delta_pct}% · {row.tier}
                  </Badge>
                </>
              )}
              {row.requested_due_date !== null && (
                <>
                  <span>·</span>
                  <span>due {row.original_due_date ?? "—"} → {row.requested_due_date}</span>
                  {!askedForPoints(row) && (
                    <Badge variant={isEscalation ? "destructive" : "warning"} className="ml-1">
                      {row.tier}
                    </Badge>
                  )}
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
        <RequestContext taskId={row.parent_clickup_task_id} requestedPoints={row.extra_points} clientId={row.client_id} />

        {row.reason && <ExtField label="Reason for extra points">{row.reason}</ExtField>}
        {row.due_date_reason && (
          <ExtField label="Reason for due-date push">{row.due_date_reason}</ExtField>
        )}
        {row.info_request && <ExtField label="Question asked">{row.info_request}</ExtField>}
        {row.info_response && <ExtField label="Requester's answer">{row.info_response}</ExtField>}

        {asking ? (
          <AskBox
            value={rejectReason}
            onChange={setRejectReason}
            onCancel={onAskCancel}
            onConfirm={onAskConfirm}
            busy={busy}
          />
        ) : rejecting ? (
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
            onAsk={onAskStart}
            busy={busy}
            approveLabel={isEscalation ? "Approve & send to owner" : "Approve & push subtask"}
          />
        )}
      </CardContent>
    </Card>
  );
}

function RevCard({
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
  row: RevJoined;
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
              <Badge variant="warning" className="ml-1">→ {row.revision_suffix}</Badge>
            </div>
          </div>
          <div className="text-label-small text-m-on-surface-variant whitespace-nowrap">
            {new Date(row.created_at).toLocaleString()}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <RequestContext taskId={row.parent_clickup_task_id} clientId={row.client_id} />

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
            approveLabel="Approve & create task"
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

function ExtField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-label-small text-m-on-surface-variant">{label}</div>
      <p className="text-body-medium text-m-on-surface whitespace-pre-wrap">{children}</p>
    </div>
  );
}

function AskBox({
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
        placeholder="What do you need to know before deciding?"
        rows={3}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={onConfirm} disabled={busy}>
          Send question
        </Button>
      </div>
    </div>
  );
}

function ActionRow({
  onReject,
  onApprove,
  onAsk,
  busy,
  approveLabel,
}: {
  onReject: () => void;
  onApprove: () => void;
  onAsk?: () => void;
  busy: boolean;
  approveLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      {onAsk && (
        <Button variant="ghost" size="sm" onClick={onAsk} disabled={busy} className="gap-2">
          <HelpCircle className="h-4 w-4" />
          Ask for info
        </Button>
      )}
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
            className="flex items-center justify-between gap-3 rounded-xl border border-m-outline-variant bg-m-surface px-4 py-2"
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

function extensionSubtitle(r: ExtensionRequestRow): string {
  const parts: string[] = [];
  if (askedForPoints(r)) parts.push(`+${fmtPtH(r.extra_points)} (${r.delta_pct}%)`);
  if (r.requested_due_date !== null) parts.push(`due → ${r.requested_due_date}`);
  return parts.join(" · ") || "—";
}

function recentBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" | "muted" | "success" | "warning" {
  if (status === "approved" || status === "auto_approved") return "success";
  if (status === "rejected") return "destructive";
  return "muted";
}

export default Approvals;
