// src/pages/Scope.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { StageSection, type StageStatus } from "@/components/StageSection";
import { ScopeConfirmStage } from "@/components/scope-confirm/ScopeConfirmStage";
import { TaskBreakdownStage } from "@/components/task-breakdown/TaskBreakdownStage";
import { ScopeEditor } from "@/components/ScopeEditor";
import { BriefIntelligenceView } from "@/components/BriefIntelligenceView";
import { QuickBriefSheet, type QuickBriefSheetBrief } from "@/components/QuickBriefSheet";
import { useBrief, useUpdateBrief, useConfirmScope } from "@/hooks/useBriefs";
import { useScope, useUpsertScope } from "@/hooks/useScopes";
import { useScopeMapPlacements } from "@/hooks/useScopeMap";
import { useLineTasks } from "@/hooks/usePlacementTasks";
import { placementDisposition } from "@/types/sow-placements";
import {
  useBriefIntelligence,
  useApproveBriefIntelligence,
  useRejectBriefIntelligence,
  useUpdateBriefIntelligence,
} from "@/hooks/useBriefIntelligence";
import { useDepartments } from "@/hooks/useDepartments";
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

export function Scope() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const userId = useCurrentUserId();

  const [editingIntel, setEditingIntel] = useState(false);
  const [quickBriefOpen, setQuickBriefOpen] = useState(false);

  const { data: brief } = useBrief(id);
  const { data: intelligence, isLoading: intelLoading } = useBriefIntelligence(id, {
    paused: editingIntel,
  });
  const { data: departments } = useDepartments();
  const { data: scope } = useScope(id);
  const updateBrief = useUpdateBrief();
  const upsertScope = useUpsertScope();
  const confirmScope = useConfirmScope(id);
  const approve = useApproveBriefIntelligence(id ?? "");
  const reject = useRejectBriefIntelligence(id ?? "");
  const updateIntel = useUpdateBriefIntelligence(id ?? "");

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
  const scopeLocked = brief?.status === "scoped";

  // Task breakdown (Stage 3) is "done" once every billable quote line has at
  // least one task with a department assigned. Shared query keys with the stage
  // body, so this doesn't double-fetch.
  const { data: placements } = useScopeMapPlacements(id);
  const { data: lineTasks } = useLineTasks(id);
  const breakdownComplete = useMemo(() => {
    const billable = (placements ?? []).filter(
      (p) => placementDisposition(p) === "new_billable",
    );
    if (billable.length === 0) return false;
    const tasksByPlacement = new Map<string, typeof lineTasks>();
    for (const t of lineTasks ?? []) {
      const arr = tasksByPlacement.get(t.placement_id) ?? [];
      arr.push(t);
      tasksByPlacement.set(t.placement_id, arr);
    }
    return billable.every((p) =>
      (tasksByPlacement.get(p.id) ?? []).some((t) => !!t.department_id),
    );
  }, [placements, lineTasks]);

  const s1status: StageStatus = scopeConfirmed ? "done" : "active";
  const s2status: StageStatus = !scopeConfirmed ? "locked" : isApproved ? "done" : "active";
  const s3status: StageStatus = !isApproved ? "locked" : breakdownComplete ? "done" : "active";
  const s4status: StageStatus = !isApproved ? "locked" : scopeLocked ? "done" : "active";

  // Auto-open the first actionable (active) stage, and advance as gates clear.
  const activeStage =
    s1status === "active"
      ? 1
      : s2status === "active"
        ? 2
        : s3status === "active"
          ? 3
          : s4status === "active"
            ? 4
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
      navigate(`/briefs/${id}/sow-check`);
    } catch {
      toast.error("Failed to lock scope");
    }
  };

  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/inbox"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-title-large truncate">{brief.raw_subject ?? "(no subject)"}</h1>
          <div className="flex items-center gap-2 mt-1">
            {brief.intent_type && (
              <Badge className="text-label-small">
                {INTENT_LABEL[brief.intent_type] ?? brief.intent_type}
              </Badge>
            )}
            {brief.sender_email && (
              <span className="text-body-small text-m-on-surface-variant">
                {brief.sender_email}
              </span>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setQuickBriefOpen(true)}>
          Brief as-is
        </Button>
      </div>

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
        }}
      />

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
            <BriefIntelligenceView
              intelligence={intelligence ?? null}
              isLoading={intelLoading}
              departments={departments}
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
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-body-small text-red-800">
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

        {/* Stage 3 — Task Breakdown */}
        <StageSection
          index={3}
          title="Task Breakdown"
          subtitle="Map tasks, departments, time & sprint points per quote item"
          status={s3status}
          open={openStage === 3}
          onToggle={() => toggleStage(3)}
        >
          <div className="space-y-4">
            <TaskBreakdownStage briefId={id!} />
            <div className="flex border-t border-m-outline-variant pt-3">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => setOpenStage(2)}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to brief
              </Button>
            </div>
          </div>
        </StageSection>

        {/* Stage 4 — Scope Edit */}
        <StageSection
          index={4}
          title="Scope Edit"
          subtitle="Finalise the written scope"
          status={s4status}
          open={openStage === 4}
          onToggle={() => toggleStage(4)}
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
                onClick={() => setOpenStage(3)}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to breakdown
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
                <Button onClick={lockScope}>Lock scope</Button>
              </div>
            </div>
          </div>
        </StageSection>
      </div>
    </div>
  );
}
