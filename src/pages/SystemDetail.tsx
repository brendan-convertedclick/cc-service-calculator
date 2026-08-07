// src/pages/SystemDetail.tsx
//
// /systems/:id — one system: goal, owner, steps, revisions, and (kind='internal'
// only) an overhead-vs-estimate read, plus the Phase 6 drag-and-drop canvas
// (mounted at the bottom, its own window bar owns Tidy up/Propose/Unsaved).
// ZERO ClickUp writes happen from this page.

import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Plus } from "lucide-react";
import {
  MATERIALISE_LABEL,
  PLACEHOLDER_GOAL,
  SYSTEM_BANDS,
  SYSTEM_BAND_LABEL,
  SYSTEM_KIND_LABEL,
  useSystemDefinition,
  useSystemOverhead,
  useUpdateSystem,
  type SystemDefinitionWithJoins,
} from "@/hooks/useSystemDefinitions";
import { useCreateStep, useSystemSteps } from "@/hooks/useProcessSteps";
import {
  useProposeRevision,
  usePublishRevision,
  useRequestChanges,
  useSystemRevisions,
} from "@/hooks/useSystemRevisions";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useDepartments } from "@/hooks/useDepartments";
import { useTeam } from "@/hooks/useTeam";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/db";
// Reused as-is from the edge function's shared lib — pure TS, type-only here
// (erased at build time), same cross-import pattern useSystemRevisions.ts
// already uses at runtime for `diffSteps`.
import type { DiffSummary } from "../../supabase/functions/_shared/system-diff";

// @xyflow/react is lazy-loaded like every other page in this app so it never
// enters the main bundle — this is a component within a page, not a route,
// so it needs its own Suspense boundary (see the mount site below) rather
// than relying on App.tsx's route-level one.
const SystemCanvas = lazy(() =>
  import("@/components/systems/SystemCanvas").then((m) => ({ default: m.SystemCanvas }))
);

type DeptRow = Database["public"]["Tables"]["departments"]["Row"];
type TeamRow = Database["public"]["Tables"]["team_members"]["Row"];
type SystemRevisionRow = Database["public"]["Tables"]["system_revisions"]["Row"];

const REVISION_STATE_BADGE: Record<string, { variant: "muted" | "warning" | "success" | "outline"; label: string }> = {
  draft: { variant: "muted", label: "Draft" },
  proposed: { variant: "warning", label: "Proposed" },
  published: { variant: "success", label: "Published" },
  superseded: { variant: "outline", label: "Superseded" },
};

// The five fields diffSteps() (system-diff.ts) compares on a 'changed' step.
const DIFF_FIELD_LABEL: Record<string, string> = {
  title: "Title",
  estimated_hours: "Hours",
  department_id: "Department",
  owner_id: "Owner",
  materialise_as: "Materialise as",
};

function formatDiffValue(
  field: string,
  value: unknown,
  deptById: Map<string, DeptRow>,
  teamById: Map<string, TeamRow>
): string {
  if (value === null || value === undefined) return "—";
  if (field === "department_id") return deptById.get(String(value))?.name ?? "Unknown dept";
  if (field === "owner_id") return teamById.get(String(value))?.full_name ?? "Unknown";
  if (field === "estimated_hours") return `${value}h`;
  if (field === "materialise_as")
    return MATERIALISE_LABEL[String(value) as keyof typeof MATERIALISE_LABEL] ?? String(value);
  return String(value);
}

type FormState = {
  name: string;
  band: string;
  owner_id: string;
  expert_id: string;
  review_due_at: string;
  goal_statement: string;
  goal_metric: string;
  trigger_text: string;
  definition_of_done: string;
  exceptions_md: string;
};

function toForm(s: SystemDefinitionWithJoins): FormState {
  return {
    name: s.name,
    band: s.band ?? "",
    owner_id: s.owner_id ?? "",
    expert_id: s.expert_id ?? "",
    review_due_at: s.review_due_at ?? "",
    goal_statement: s.goal_statement,
    goal_metric: s.goal_metric ?? "",
    trigger_text: s.trigger_text ?? "",
    definition_of_done: s.definition_of_done ?? "",
    exceptions_md: s.exceptions_md ?? "",
  };
}

export function SystemDetail() {
  const { id } = useParams();
  const { data: system, isLoading } = useSystemDefinition(id);
  const { data: steps = [] } = useSystemSteps(id);
  const addStep = useCreateStep();

  // The system page is where people look for this, so it lives here rather
  // than only on the service's Process flow. For a kind='service' system the
  // step carries service_id too, so it shows up in both places and stays in
  // one bucket of process_steps_ordinal_idx.
  function onAddStep() {
    if (!id) return;
    addStep.mutate(
      {
        system_id: id,
        service_id: system?.service_id ?? null,
        ordinal: steps.reduce((max, s) => Math.max(max, s.ordinal), 0) + 1,
        title: "New step",
        department_id: null,
        estimated_hours: null,
      },
      {
        onSuccess: () => toast.success("Step added — set its department and hours on the canvas"),
        onError: (e) => toast.error((e as { message?: string })?.message || "Could not add step"),
      },
    );
  }
  const { data: depts = [] } = useDepartments();
  const { data: team = [] } = useTeam();
  const update = useUpdateSystem();
  const { data: revisions = [], isLoading: revisionsLoading } = useSystemRevisions(id);
  const { role } = useCurrentRole();
  const canApprove = role === "admin" || role === "owner";

  const deptById = useMemo(() => new Map(depts.map((d) => [d.id, d])), [depts]);
  const teamById = useMemo(() => new Map(team.map((t) => [t.id, t])), [team]);

  const [form, setForm] = useState<FormState | null>(null);
  // Lifted so both RevisionsCard's own trigger AND the canvas window bar's
  // "Propose" button (P5's dialog, wired per this phase's task) can open the
  // same dialog instance.
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeReason, setProposeReason] = useState("");

  // Re-seed whenever the *identity* of the system changes (route param swap
  // or first load) — not on every background refetch, which would clobber an
  // in-progress edit. Same convention as ServiceDetail.tsx.
  useEffect(() => {
    if (system) setForm(toForm(system));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system?.id]);

  function save<K extends keyof FormState>(field: K, raw: string) {
    if (!id || !system) return;
    const value = raw.trim();
    if (field === "name" && !value) {
      toast.error("Name can't be empty");
      setForm(toForm(system));
      return;
    }
    if (field === "goal_statement" && !value) {
      toast.error("Goal can't be empty — a system must always have a goal");
      setForm(toForm(system));
      return;
    }
    const nullable = new Set<keyof FormState>([
      "band",
      "owner_id",
      "expert_id",
      "review_due_at",
      "goal_metric",
      "trigger_text",
      "definition_of_done",
      "exceptions_md",
    ]);
    const patchValue = value || (nullable.has(field) ? null : value);
    update.mutate(
      { id, patch: { [field]: patchValue } },
      { onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save") },
    );
  }

  // Three separate single-condition guards (not one combined check) so each
  // narrows cleanly: isLoading, then a genuinely-missing system (bad/deleted
  // id — resolves isLoading=false with no row), THEN the one-tick gap before
  // the effect above seeds `form`. Checking `!form` before `!system` would
  // report "Loading…" forever for a bad id, since the effect that sets form
  // is itself gated on `system` existing.
  if (isLoading) {
    return <div className="p-6 text-body-medium text-m-on-surface-variant">Loading…</div>;
  }
  if (!system) {
    return <div className="p-6 text-body-medium text-m-on-surface-variant">System not found.</div>;
  }
  if (!form) {
    return <div className="p-6 text-body-medium text-m-on-surface-variant">Loading…</div>;
  }

  const linkLabel =
    system.kind === "service"
      ? system.service_name
      : system.kind === "recurring"
        ? system.recurring_service_name
        : system.kind === "internal"
          ? system.time_category_label
          : null;

  const totalStepHours = steps.reduce((sum, s) => sum + (s.estimated_hours ?? 0), 0);
  const isUnmapped = system.goal_statement === PLACEHOLDER_GOAL;
  const latestRevision = revisions[0] ?? null;

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link to="/systems"><ArrowLeft className="h-4 w-4" /> Systems</Link>
          </Button>

        {/* Header */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  onBlur={(e) => save("name", e.target.value)}
                  aria-label="System name"
                  className="h-auto border-none px-0 text-headline-small font-semibold shadow-none focus-visible:ring-0"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{SYSTEM_KIND_LABEL[system.kind]}</Badge>
                  {linkLabel && <span className="text-label-small text-m-on-surface-variant">{linkLabel}</span>}
                  {isUnmapped && <Badge variant="warning">No goal set</Badge>}
                  {latestRevision && (
                    <span className="text-label-small text-m-on-surface-variant/70">
                      — {latestRevision.state} rev {latestRevision.revision}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <FieldLabel label="Band">
                <select
                  value={form.band}
                  onChange={(e) => {
                    setForm({ ...form, band: e.target.value });
                    save("band", e.target.value);
                  }}
                  className="h-9 w-full rounded-md border border-m-outline bg-m-surface px-2 text-body-small text-m-on-surface"
                >
                  <option value="">— none</option>
                  {SYSTEM_BANDS.map((b) => (
                    <option key={b} value={b}>{SYSTEM_BAND_LABEL[b]}</option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Owner">
                <select
                  value={form.owner_id}
                  onChange={(e) => {
                    setForm({ ...form, owner_id: e.target.value });
                    save("owner_id", e.target.value);
                  }}
                  className="h-9 w-full rounded-md border border-m-outline bg-m-surface px-2 text-body-small text-m-on-surface"
                >
                  <option value="">— unassigned</option>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Expert">
                <select
                  value={form.expert_id}
                  onChange={(e) => {
                    setForm({ ...form, expert_id: e.target.value });
                    save("expert_id", e.target.value);
                  }}
                  className="h-9 w-full rounded-md border border-m-outline bg-m-surface px-2 text-body-small text-m-on-surface"
                >
                  <option value="">— unassigned</option>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Review due">
                <Input
                  type="date"
                  value={form.review_due_at}
                  onChange={(e) => setForm({ ...form, review_due_at: e.target.value })}
                  onBlur={(e) => save("review_due_at", e.target.value)}
                  className="h-9"
                />
              </FieldLabel>
            </div>
          </CardContent>
        </Card>

        {/* Goal — the point of the feature. Prominent, always visible, editable. */}
        <Card className="border-m-primary/40 bg-m-primary-container/15">
          <CardHeader>
            <CardTitle className="text-title-medium">Goal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={form.goal_statement}
              onChange={(e) => setForm({ ...form, goal_statement: e.target.value })}
              onBlur={(e) => save("goal_statement", e.target.value)}
              rows={2}
              className="text-body-large"
              placeholder="What does this system exist to achieve?"
            />
            <div className="space-y-1">
              <Label htmlFor="goal-metric">Goal metric</Label>
              <Input
                id="goal-metric"
                value={form.goal_metric}
                onChange={(e) => setForm({ ...form, goal_metric: e.target.value })}
                onBlur={(e) => save("goal_metric", e.target.value)}
                placeholder="e.g. 20 qualified leads / month"
              />
            </div>
          </CardContent>
        </Card>

        {/* Trigger / definition of done / exceptions */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <FieldLabel label="Trigger" stacked>
              <Textarea
                value={form.trigger_text}
                onChange={(e) => setForm({ ...form, trigger_text: e.target.value })}
                onBlur={(e) => save("trigger_text", e.target.value)}
                rows={2}
                placeholder="What kicks this system off?"
              />
            </FieldLabel>
            <FieldLabel label="Definition of done" stacked>
              <Textarea
                value={form.definition_of_done}
                onChange={(e) => setForm({ ...form, definition_of_done: e.target.value })}
                onBlur={(e) => save("definition_of_done", e.target.value)}
                rows={2}
                placeholder="How do we know this system's work is complete?"
              />
            </FieldLabel>
            <FieldLabel label="Exceptions" stacked>
              <Textarea
                value={form.exceptions_md}
                onChange={(e) => setForm({ ...form, exceptions_md: e.target.value })}
                onBlur={(e) => save("exceptions_md", e.target.value)}
                rows={2}
                placeholder="Edge cases this system doesn't cover"
              />
            </FieldLabel>
          </CardContent>
        </Card>

        {/* Steps — add here, then shape them on the canvas below. */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-title-medium">
              Steps <span className="text-label-medium font-normal text-m-on-surface-variant">· {steps.length}</span>
            </CardTitle>
            <div className="flex items-center gap-3">
              {totalStepHours > 0 && (
                <span className="font-mono text-label-medium text-m-on-surface-variant">{totalStepHours}h estimated</span>
              )}
              <Button size="sm" variant="outline" className="gap-1.5" disabled={addStep.isPending} onClick={onAddStep}>
                <Plus className="h-4 w-4" /> Add step
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {steps.length === 0 ? (
              <p className="px-5 pb-5 text-body-medium text-m-on-surface-variant">
                No steps yet.
              </p>
            ) : (
              <ol className="divide-y divide-m-outline-variant">
                {steps.map((s) => {
                  const dept = s.department_id ? deptById.get(s.department_id) : null;
                  const owner = s.owner_id ? teamById.get(s.owner_id) : null;
                  return (
                    <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="w-5 flex-none text-center font-mono text-label-small text-m-on-surface-variant">
                        {s.ordinal}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-medium text-m-on-surface">{s.title}</p>
                        <p className="flex items-center gap-1.5 truncate text-label-small text-m-on-surface-variant">
                          <span
                            className="h-2 w-2 flex-none rounded-full"
                            style={{ background: dept?.color ?? "var(--mcolor-outline-variant)" }}
                          />
                          {dept?.name ?? "No department"}{owner ? ` · ${owner.full_name}` : ""}
                        </p>
                      </div>
                      <Badge variant="muted" className="flex-none text-label-small">
                        {MATERIALISE_LABEL[s.materialise_as] ?? s.materialise_as}
                      </Badge>
                      <span className="w-14 flex-none text-right font-mono text-label-small text-m-on-surface-variant">
                        {s.estimated_hours != null ? `${s.estimated_hours}h` : "—"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        <RevisionsCard
          systemId={system.id}
          revisions={revisions}
          isLoading={revisionsLoading}
          canApprove={canApprove}
          deptById={deptById}
          teamById={teamById}
          proposeOpen={proposeOpen}
          setProposeOpen={setProposeOpen}
          proposeReason={proposeReason}
          setProposeReason={setProposeReason}
        />

        {system.kind === "internal" && (
          <OverheadPanel system={system} totalStepHours={totalStepHours} />
        )}

        {/* Canvas — drag-and-drop visual mapping of this system's steps,
            handoffs and department ownership. The window bar (breadcrumb,
            Unsaved, Tidy up, Propose) is rendered inside SystemCanvas itself
            — that's where the state it depends on already lives — so this
            card is just a frame around it, no separate CardHeader. */}
        <Card className="overflow-hidden p-0">
          <Suspense
            fallback={
              <div className="flex h-[680px] items-center justify-center text-body-medium text-m-on-surface-variant">
                Loading canvas…
              </div>
            }
          >
            <SystemCanvas systemId={system.id} systemName={system.name} onPropose={() => setProposeOpen(true)} />
          </Suspense>
        </Card>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({
  label,
  stacked,
  children,
}: {
  label: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1", stacked && "space-y-1.5")}>
      <Label className="text-label-small text-m-on-surface-variant">{label}</Label>
      {children}
    </div>
  );
}

function OverheadPanel({
  system,
  totalStepHours,
}: {
  system: SystemDefinitionWithJoins;
  totalStepHours: number;
}) {
  const { data: actualHours = 0, isLoading } = useSystemOverhead(system.time_category_id);
  const variancePct = totalStepHours > 0 ? Math.round((actualHours / totalStepHours) * 100) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-title-medium">Overhead consumed</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-body-medium text-m-on-surface-variant">Loading…</p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-8">
            <Stat label="Actual (all-time)" value={`${actualHours.toFixed(1)}h`} />
            <Stat label="Estimated (steps)" value={totalStepHours > 0 ? `${totalStepHours.toFixed(1)}h` : "—"} />
            {variancePct !== null && (
              <Stat label="vs. estimate" value={`${variancePct}%`} warn={variancePct > 120} />
            )}
          </div>
        )}
        <p className="mt-3 text-label-small text-m-on-surface-variant">
          Summed from every team member's perpetual [Internal] task for{" "}
          {system.time_category_label ?? "this time category"}. Read-only — no ClickUp tasks are
          created or changed from this page.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className="text-label-small text-m-on-surface-variant">{label}</p>
      <p className={cn("font-mono text-title-large", warn ? "text-m-error" : "text-m-on-surface")}>{value}</p>
    </div>
  );
}

// Revision history + propose/approve. Published is the prominent entry
// (highlighted border); proposed entries default their diff open since
// that's the one someone needs to act on.
function RevisionsCard({
  systemId,
  revisions,
  isLoading,
  canApprove,
  deptById,
  teamById,
  proposeOpen,
  setProposeOpen,
  proposeReason: reason,
  setProposeReason: setReason,
}: {
  systemId: string;
  revisions: SystemRevisionRow[];
  isLoading: boolean;
  canApprove: boolean;
  deptById: Map<string, DeptRow>;
  teamById: Map<string, TeamRow>;
  // Lifted to SystemDetail so the canvas window bar's "Propose" button opens
  // this same dialog instance, not a second one.
  proposeOpen: boolean;
  setProposeOpen: (open: boolean) => void;
  proposeReason: string;
  setProposeReason: (reason: string) => void;
}) {
  const propose = useProposeRevision();
  const publish = usePublishRevision();
  const requestChanges = useRequestChanges();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-title-medium">
          Revisions <span className="text-label-medium font-normal text-m-on-surface-variant">· {revisions.length}</span>
        </CardTitle>
        <Dialog
          open={proposeOpen}
          onOpenChange={(open) => {
            setProposeOpen(open);
            if (!open) setReason("");
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">Propose changes</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Propose a change to this system</DialogTitle>
              <DialogDescription>
                Snapshots the current steps as a new revision. An admin or owner must approve it
                before it publishes — nothing reaches ClickUp until then.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="reason-for-change">Reason for change</Label>
              <Textarea
                id="reason-for-change"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why is this system changing?"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setProposeOpen(false)}>Cancel</Button>
              <Button
                disabled={!reason.trim() || propose.isPending}
                onClick={() => {
                  propose.mutate(
                    { systemId, reasonForChange: reason.trim() },
                    {
                      onSuccess: () => {
                        toast.success("Revision proposed");
                        setProposeOpen(false);
                        setReason("");
                      },
                      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not propose revision"),
                    }
                  );
                }}
              >
                {propose.isPending ? "Proposing…" : "Propose"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-3 p-5 pt-0">
        {isLoading && <p className="text-body-medium text-m-on-surface-variant">Loading…</p>}
        {!isLoading && revisions.length === 0 && (
          <p className="text-body-medium text-m-on-surface-variant">
            No revisions yet — this system has never been published.
          </p>
        )}
        {revisions.map((rev) => (
          <RevisionRow
            key={rev.id}
            rev={rev}
            canApprove={canApprove}
            deptById={deptById}
            teamById={teamById}
            approvePending={publish.isPending}
            requestPending={requestChanges.isPending}
            onApprove={(revisionId) =>
              publish.mutate(
                { revisionId, systemId },
                {
                  onSuccess: () => toast.success("Revision published"),
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Could not publish revision"),
                }
              )
            }
            onRequestChanges={(revisionId) =>
              requestChanges.mutate(
                { revisionId, systemId },
                {
                  onSuccess: () => toast.success("Sent back to draft"),
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update revision"),
                }
              )
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

function RevisionRow({
  rev,
  canApprove,
  deptById,
  teamById,
  approvePending,
  requestPending,
  onApprove,
  onRequestChanges,
}: {
  rev: SystemRevisionRow;
  canApprove: boolean;
  deptById: Map<string, DeptRow>;
  teamById: Map<string, TeamRow>;
  approvePending: boolean;
  requestPending: boolean;
  onApprove: (revisionId: string) => void;
  onRequestChanges: (revisionId: string) => void;
}) {
  const badge = REVISION_STATE_BADGE[rev.state] ?? { variant: "muted" as const, label: rev.state };
  const proposer = rev.proposed_by ? teamById.get(rev.proposed_by)?.full_name : null;
  const approver = rev.approved_by ? teamById.get(rev.approved_by)?.full_name : null;
  const diff = rev.diff_summary ? (rev.diff_summary as unknown as DiffSummary) : null;
  // Each date stays paired with its own label — the shared dev login
  // (team@) resolves to a null team_members id (see CLAUDE.md), so
  // `approver`/`proposer` can be null while the date is still real; a bare
  // unlabelled date reads as ambiguous, so the action verb always shows.
  const meta = [
    rev.proposed_at && `Proposed${proposer ? ` by ${proposer}` : ""} ${new Date(rev.proposed_at).toLocaleDateString()}`,
    rev.approved_at && `Approved${approver ? ` by ${approver}` : ""} ${new Date(rev.approved_at).toLocaleDateString()}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        rev.state === "published" ? "border-m-primary/40 bg-m-primary-container/10" : "border-m-outline-variant"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-label-medium text-m-on-surface-variant">Rev {rev.revision}</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        {rev.state === "proposed" && canApprove && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={requestPending} onClick={() => onRequestChanges(rev.id)}>
              Request changes
            </Button>
            <Button size="sm" disabled={approvePending} onClick={() => onApprove(rev.id)}>
              {approvePending ? "Approving…" : "Approve"}
            </Button>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-body-small text-m-on-surface">{rev.reason_for_change}</p>
      {meta && <p className="mt-1 text-label-small text-m-on-surface-variant">{meta}</p>}
      {diff && (
        <details open={rev.state === "proposed"} className="mt-2 rounded-md border border-m-outline-variant">
          <summary className="cursor-pointer select-none px-2.5 py-1.5 text-label-small font-medium text-m-on-surface-variant">
            View diff
          </summary>
          <div className="border-t border-m-outline-variant p-2.5">
            <RevisionDiffView diff={diff} deptById={deptById} teamById={teamById} />
          </div>
        </details>
      )}
    </div>
  );
}

// Two-column before/after: removed (red strikethrough) on the left, added
// (green) on the right, changed steps below with per-field "from → to". No
// amber M3 role exists (tokens.css has primary/secondary/tertiary/error only)
// — changed rows use secondary-container as the closest neutral-but-distinct
// role rather than inventing a token or a hex.
function RevisionDiffView({
  diff,
  deptById,
  teamById,
}: {
  diff: DiffSummary;
  deptById: Map<string, DeptRow>;
  teamById: Map<string, TeamRow>;
}) {
  const hasChanges = diff.added.length + diff.removed.length + diff.changed.length > 0;
  if (!hasChanges) {
    return <p className="text-label-small text-m-on-surface-variant">No step changes — reason-only revision.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-label-small font-semibold uppercase tracking-wide text-m-on-surface-variant">Before</p>
          {diff.removed.length === 0 ? (
            <p className="text-label-small text-m-on-surface-variant">No steps removed.</p>
          ) : (
            diff.removed.map((s) => (
              <p
                key={s.id}
                className="rounded bg-m-error-container px-2 py-1 text-label-small text-m-on-error-container line-through"
              >
                {s.title}
              </p>
            ))
          )}
        </div>
        <div className="space-y-1">
          <p className="text-label-small font-semibold uppercase tracking-wide text-m-on-surface-variant">After</p>
          {diff.added.length === 0 ? (
            <p className="text-label-small text-m-on-surface-variant">No steps added.</p>
          ) : (
            diff.added.map((s) => (
              <p key={s.id} className="rounded bg-m-tertiary-container px-2 py-1 text-label-small text-m-on-tertiary-container">
                + {s.title}
              </p>
            ))
          )}
        </div>
      </div>
      {diff.changed.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-label-small font-semibold uppercase tracking-wide text-m-on-surface-variant">Changed</p>
          {diff.changed.map((c) => (
            <div key={c.id} className="rounded bg-m-secondary-container px-2.5 py-1.5 text-m-on-secondary-container">
              <p className="text-body-small font-medium">{c.title}</p>
              <ul className="mt-0.5 space-y-0.5">
                {c.fields.map((f) => (
                  <li key={f.field} className="text-label-small">
                    {DIFF_FIELD_LABEL[f.field] ?? f.field}: {formatDiffValue(f.field, f.from, deptById, teamById)}
                    {" → "}
                    {formatDiffValue(f.field, f.to, deptById, teamById)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
