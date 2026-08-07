// src/pages/Scope.tsx
import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy, Link2, Pencil, Unlink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StageSection, type StageStatus } from "@/components/StageSection";
import { ScopeConfirmStage } from "@/components/scope-confirm/ScopeConfirmStage";
import { CostEstimateStage } from "@/components/scope-stages/CostEstimateStage";
import { ApproveScheduleStage } from "@/components/scope-stages/ApproveScheduleStage";
import { ScopeEditor } from "@/components/ScopeEditor";
import { BriefIntelligenceView } from "@/components/BriefIntelligenceView";
import { QuickBriefSheet, type QuickBriefSheetBrief } from "@/components/QuickBriefSheet";
import { DuplicateBriefDialog } from "@/components/briefs/DuplicateBriefDialog";
import { BriefedTaskPanel } from "@/components/briefs/BriefedTaskPanel";
import { InboxAssignModal } from "@/components/scope/InboxAssignModal";
import { useBrief, useUpdateBrief, useConfirmScope } from "@/hooks/useBriefs";
import { useAssignBriefToProject } from "@/hooks/useAssignBriefToProject";
import { useClients } from "@/hooks/useClients";
import { useScope, useUpsertScope } from "@/hooks/useScopes";
import {
  useBriefIntelligence,
  useApproveBriefIntelligence,
  useCreateBriefIntelligence,
  useRejectBriefIntelligence,
  useUpdateBriefIntelligence,
} from "@/hooks/useBriefIntelligence";
import { useBriefCE } from "@/hooks/useBriefCE";
import { useCurrentUserId } from "@/context/AuthContext";
import { isMostlyAi } from "@/lib/scope-overlap";

const INTENT_LABEL: Record<string, string> = {
  new_brief:       "New brief",
  project_thread:  "Project thread",
  retainer_thread: "Retainer",
  general_query:   "General query",
  quick_response:  "Quick response",
};

type ScopeValues = {
  enhanced_prose:   string;
  in_scope_md:      string;
  out_of_scope_md:  string;
  open_questions_md: string;
};

const EMPTY: ScopeValues = {
  enhanced_prose:   "",
  in_scope_md:      "",
  out_of_scope_md:  "",
  open_questions_md: "",
};

function concat(v: ScopeValues) {
  return `${v.enhanced_prose}\n${v.in_scope_md}\n${v.out_of_scope_md}\n${v.open_questions_md}`;
}

/** Inline-editable page title — briefs created straight into this page get
 *  named here. Commits on blur / Enter, cancels on Escape. */
function TitleField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  return (
    <input
      type="text"
      aria-label="Brief name"
      placeholder="Name this brief…"
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = (draft ?? "").trim();
        const cancelled = cancelledRef.current;
        cancelledRef.current = false;
        setDraft(null);
        if (!cancelled && next !== value.trim()) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelledRef.current = true;
          e.currentTarget.blur();
        }
      }}
      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-title-large text-m-on-surface hover:border-m-outline-variant focus:border-m-primary focus:bg-m-surface focus:outline-none"
    />
  );
}

export function Scope() {
  const { id } = useParams<{ id: string }>();
  const userId = useCurrentUserId();

  const [editingIntel, setEditingIntel] = useState(false);
  const [quickBriefOpen, setQuickBriefOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const { data: brief } = useBrief(id);
  const { data: clients } = useClients();
  const unlinkProject = useAssignBriefToProject();
  const linkedProjectId = brief?.parent_project_id ?? null;
  const { data: linkedProject } = useQuery({
    enabled: !!linkedProjectId,
    queryKey: ["project-name", linkedProjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name")
        .eq("id", linkedProjectId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  async function handleUnlinkProject() {
    if (!id) return;
    try {
      await unlinkProject.mutateAsync({
        briefId: id,
        projectId: null,
        previousProjectId: linkedProjectId,
      });
      toast.success("Unlinked from project");
    } catch {
      toast.error("Failed to unlink");
    }
  }
  const { data: intelligence, isLoading: intelLoading } = useBriefIntelligence(id, {
    paused: editingIntel,
  });
  const { data: scope } = useScope(id);
  const { data: ce } = useBriefCE(id);
  const updateBrief = useUpdateBrief();
  const upsertScope = useUpsertScope();
  const confirmScope = useConfirmScope(id);
  const approve = useApproveBriefIntelligence(id ?? "");
  const reject = useRejectBriefIntelligence(id ?? "");
  const updateIntel = useUpdateBriefIntelligence(id ?? "");
  const createIntel = useCreateBriefIntelligence(id ?? "");

  const [rejectNotes, setRejectNotes] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [scopeValues, setScopeValues] = useState<ScopeValues>(EMPTY);
  const [lastAiDraft, setLastAiDraft] = useState("");
  const [openStage, setOpenStage] = useState<number | null>(null);

  // Pre-populate scopeValues from an existing scope row (e.g. on page reload).
  useEffect(() => {
    if (scope) {
      const v: ScopeValues = {
        enhanced_prose:   scope.enhanced_prose   ?? "",
        in_scope_md:      scope.in_scope_md      ?? "",
        out_of_scope_md:  scope.out_of_scope_md  ?? "",
        open_questions_md: scope.open_questions_md ?? "",
      };
      setScopeValues(v);
      if (scope.ai_drafted) setLastAiDraft(concat(v));
    }
  }, [scope]);

  // Stage gating.
  const amStatus = intelligence?.am_status ?? "pending";
  const isApproved = amStatus === "approved";
  const isRejected = amStatus === "rejected";
  const scopeConfirmed = !!brief?.scope_confirmed_at;
  // "Locked" must be durable: the status moves on past "scoped" as the brief
  // advances (quoted → briefed), but scopes.locked_at records that the staged
  // flow locked a scope at some point. Quick-briefed ("as-is") briefs never do.
  const scopeLocked = brief?.status === "scoped" || !!scope?.locked_at;

  const briefed = brief?.status === "briefed";
  // Quick-briefed ("Brief as-is") without ever locking a scope: the staged
  // scoping flow doesn't apply — the work is already in ClickUp.
  const briefedAsIs = briefed && !scopeLocked;

  const s1status: StageStatus = scopeConfirmed ? "done" : "active";
  const s2status: StageStatus = !scopeConfirmed ? "locked" : isApproved ? "done" : "active";
  const s3status: StageStatus = !isApproved ? "locked" : scopeLocked ? "done" : "active";
  const s4status: StageStatus = !scopeLocked ? "locked" : ce ? "done" : "active";
  const s5status: StageStatus = !ce ? "locked" : briefed ? "done" : "active";

  // Auto-open the first actionable (active) stage, and advance as gates clear.
  const activeStage =
    s1status === "active" ? 1
    : s2status === "active" ? 2
    : s3status === "active" ? 3
    : s4status === "active" ? 4
    : s5status === "active" ? 5
    : 0;
  const prevActiveRef = useRef<number | null>(null);
  useEffect(() => {
    if (activeStage !== prevActiveRef.current) {
      prevActiveRef.current = activeStage;
      if (activeStage) setOpenStage(activeStage);
    }
  }, [activeStage]);

  if (!brief) return <div className="p-6 text-body-medium">Loading…</div>;

  const toggleStage = (n: number) => setOpenStage((cur) => (cur === n ? null : n));

  const handleConfirmScope = async () => {
    try {
      await confirmScope.mutateAsync({ confirmed: true, userId });
      toast.success("Scope confirmed — review the brief next");
    } catch {
      toast.error("Failed to confirm scope");
    }
  };

  const handleApprove = async () => {
    try {
      await approve.mutateAsync();
      toast.success("Brief approved — you can now build the scope");
    } catch {
      toast.error("Failed to approve");
    }
  };

  const handleReject = async () => {
    if (!rejectNotes.trim()) {
      toast.error("Add notes so the AI knows what to fix");
      return;
    }
    try {
      await reject.mutateAsync({ notes: rejectNotes });
      setRejectNotes("");
      setShowRejectInput(false);
      toast.success("Rejected — intake will regenerate on next run");
    } catch {
      toast.error("Failed to reject");
    }
  };

  const lockScope = async () => {
    if (!id) return;
    try {
      await upsertScope.mutateAsync({
        brief_id: id,
        ...scopeValues,
        ai_drafted: lastAiDraft ? isMostlyAi(concat(scopeValues), lastAiDraft) : false,
        locked_at: new Date().toISOString(),
        locked_by: userId,
      });
      await updateBrief.mutateAsync({ id, patch: { status: "scoped" } });
      // Stay in the staged flow — the cost estimate is the next stage here,
      // not a separate screen. The scope map remains at /briefs/:id/sow-check.
      setOpenStage(4);
      toast.success("Scope locked — build the cost estimate next");
    } catch {
      toast.error("Failed to lock scope");
    }
  };

  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/briefs"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <TitleField
            value={brief.raw_subject ?? ""}
            onCommit={(v) =>
              updateBrief
                .mutateAsync({ id: brief.id, patch: { raw_subject: v || null } })
                .catch(() => toast.error("Failed to rename the brief"))
            }
          />
          <div className="flex items-center gap-2 mt-1">
            {briefed && (
              <Badge variant="success" className="text-label-small">
                Briefed
              </Badge>
            )}
            {brief.intent_type && (
              <Badge variant="muted" className="text-label-small">
                {INTENT_LABEL[brief.intent_type] ?? brief.intent_type}
              </Badge>
            )}
            {!brief.client_id && (
              <Select
                onValueChange={(v) =>
                  updateBrief
                    .mutateAsync({ id: brief.id, patch: { client_id: v } })
                    .catch(() => toast.error("Failed to assign the client"))
                }
              >
                <SelectTrigger
                  className="h-7 w-56 text-label-medium"
                  aria-label="Assign a client"
                >
                  <SelectValue placeholder="Assign a client…" />
                </SelectTrigger>
                <SelectContent>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {brief.sender_email && (
              <span className="text-body-small text-m-on-surface-variant">
                {brief.sender_email}
              </span>
            )}
          </div>
        </div>
        {briefed && brief.clickup_task_url && !editingTask && (
          <Button variant="outline" size="sm" onClick={() => setEditingTask(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit task
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setDuplicateOpen(true)}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Duplicate
        </Button>
        {!briefed && (
          <Button variant="outline" size="sm" onClick={() => setQuickBriefOpen(true)}>
            Brief as-is
          </Button>
        )}
        {linkedProjectId ? (
          <div className="flex items-center gap-1">
            <Button asChild variant="outline" size="sm" className="max-w-56 text-label-small">
              <Link to={`/projects/${linkedProjectId}`} title={linkedProject?.name ?? "Project"}>
                <span className="truncate">{linkedProject?.name ?? "Project"}</span>
                <span className="shrink-0">→</span>
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Change project"
              onClick={() => setAssignOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Unlink from project"
              disabled={unlinkProject.isPending}
              onClick={handleUnlinkProject}
            >
              <Unlink className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
            <Link2 className="mr-1.5 h-3.5 w-3.5" />
            Link to project
          </Button>
        )}
      </div>

      <DuplicateBriefDialog
        brief={brief}
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
      />

      {brief && (
        <InboxAssignModal
          brief={brief}
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
        />
      )}

      <QuickBriefSheet
        open={quickBriefOpen}
        onOpenChange={setQuickBriefOpen}
        brief={{
          id: brief.id,
          client_id: brief.client_id,
          intent_type: brief.intent_type,
          raw_subject: brief.raw_subject,
          quick_task_suggestion: brief.quick_task_suggestion as
            | QuickBriefSheetBrief["quick_task_suggestion"]
            | null,
          billing_type: brief.billing_type as QuickBriefSheetBrief["billing_type"],
          assignee_id: brief.assignee_id,
        }}
      />

      {briefedAsIs ? (
        /* Briefed as-is: the work is already a ClickUp task, so the staged
           scoping flow doesn't apply. Show the task's details read-only; the
           header "Edit task" button flips the synced fields to editable. */
        <BriefedTaskPanel
          brief={brief}
          howBriefed="Briefed as-is"
          editing={editingTask}
          onExitEdit={() => setEditingTask(false)}
        />
      ) : (
      <div className="space-y-3">
        {/* Stage 1 — In / Out of Scope (the gate) */}
        <StageSection
          index={1}
          title="In / Out of Scope"
          subtitle="Confirm what's included, new, or out of scope"
          status={s1status}
          open={openStage === 1}
          onToggle={() => toggleStage(1)}
        >
          <ScopeConfirmStage
            key={id}
            briefId={id!}
            clientId={brief.client_id}
            confirmed={scopeConfirmed}
            confirming={confirmScope.isPending}
            onConfirm={handleConfirmScope}
            onContinue={() => setOpenStage(2)}
          />
        </StageSection>

        {/* Stage 2 — The Brief */}
        <StageSection
          index={2}
          title="The Brief"
          subtitle="Review the AI brief and approve"
          status={s2status}
          open={openStage === 2}
          onToggle={() => toggleStage(2)}
        >
          <div className="space-y-4">
            {/* Manual briefs have no AI-generated intelligence — offer to
                start one so the stage isn't a dead end. */}
            {!intelligence && !intelLoading && (
              <Card>
                <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                  <p className="max-w-md text-body-small text-m-on-surface-variant">
                    No AI brief yet — briefs created manually don&apos;t get one
                    automatically. Write it yourself to review and approve, then
                    the scope edit unlocks as usual.
                  </p>
                  <Button
                    size="sm"
                    disabled={createIntel.isPending}
                    onClick={() =>
                      createIntel
                        .mutateAsync({ summary: brief.raw_body?.trim() || brief.raw_subject })
                        .then(() => toast.success("Brief started — edit and approve it"))
                        .catch(() => toast.error("Failed to start the brief"))
                    }
                  >
                    {createIntel.isPending ? "Starting…" : "Write the brief manually"}
                  </Button>
                </CardContent>
              </Card>
            )}
            <BriefIntelligenceView
              briefId={id!}
              intelligence={intelligence ?? null}
              isLoading={intelLoading}
              onEditingChange={setEditingIntel}
              onSave={async (patch) => {
                try {
                  await updateIntel.mutateAsync(patch);
                  toast.success("Brief updated");
                } catch (e) {
                  toast.error("Failed to save changes");
                  throw e;
                }
              }}
            />

            {/* AM review actions — only when pending and intelligence exists */}
            {!isApproved && !isRejected && intelligence && !editingIntel && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  {showRejectInput ? (
                    <div className="space-y-2">
                      <Textarea
                        placeholder="What needs to change? The AI will use these notes when it regenerates…"
                        rows={3}
                        value={rejectNotes}
                        onChange={(e) => setRejectNotes(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowRejectInput(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleReject}
                          disabled={reject.isPending}
                        >
                          {reject.isPending ? "Rejecting…" : "Reject & regenerate"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowRejectInput(true)}
                      >
                        Reject — needs changes
                      </Button>
                      <Button onClick={handleApprove} disabled={approve.isPending}>
                        {approve.isPending ? "Approving…" : "Approve → edit scope"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Rejected state */}
            {isRejected && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-body-small text-destructive">
                Rejected. Intake will regenerate the intelligence on the next run.
                {intelligence?.am_notes && (
                  <p className="mt-1 font-medium">Notes: {intelligence.am_notes}</p>
                )}
              </div>
            )}

            <div className="flex border-t border-m-outline-variant pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => setOpenStage(1)}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to scope
              </Button>
            </div>
          </div>
        </StageSection>

        {/* Stage 3 — Scope Edit */}
        <StageSection
          index={3}
          title="Scope Edit"
          subtitle="Finalise the written scope"
          status={s3status}
          open={openStage === 3}
          onToggle={() => toggleStage(3)}
        >
          <div className="space-y-4">
            <ScopeEditor
              value={scopeValues}
              onChange={(v) => setScopeValues({ ...scopeValues, ...v })}
            />
            <div className="flex items-center gap-2 border-t border-m-outline-variant pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => setOpenStage(2)}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to brief
              </Button>
              <div className="ml-auto flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    upsertScope
                      .mutateAsync({ brief_id: id!, ...scopeValues, ai_drafted: false })
                      .then(() => toast.success("Saved"))
                      .catch(() => toast.error("Failed to save"))
                  }
                >
                  Save draft
                </Button>
                <Button onClick={() => setLockConfirmOpen(true)}>Lock scope</Button>
              </div>
            </div>
          </div>
        </StageSection>

        {/* Stage 4 — Cost Estimate */}
        <StageSection
          index={4}
          title="Cost Estimate"
          subtitle="Create the estimate, PDF and client response"
          status={s4status}
          open={openStage === 4}
          onToggle={() => toggleStage(4)}
        >
          <CostEstimateStage
            briefId={id!}
            clientId={brief.client_id}
            parentProjectId={brief.parent_project_id}
            summaryPrefill={
              scopeValues.enhanced_prose || (intelligence?.summary ?? "")
            }
          />
        </StageSection>

        {/* Stage 5 — Approve & Schedule */}
        <StageSection
          index={5}
          title="Approve & Schedule"
          subtitle="Record the approval and schedule work to the team"
          status={s5status}
          open={openStage === 5}
          onToggle={() => toggleStage(5)}
        >
          <ApproveScheduleStage briefId={id!} briefStatus={brief.status} />
        </StageSection>
      </div>
      )}

      <Dialog open={lockConfirmOpen} onOpenChange={setLockConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lock this scope?</DialogTitle>
            <DialogDescription>
              This confirms the written scope as final and moves the brief on to the
              SOW step. Save a draft first if you&apos;re not ready to commit.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockConfirmOpen(false)}>
              Keep editing
            </Button>
            <Button
              disabled={upsertScope.isPending || updateBrief.isPending}
              onClick={async () => {
                setLockConfirmOpen(false);
                await lockScope();
              }}
            >
              {upsertScope.isPending ? "Locking…" : "Lock scope"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
