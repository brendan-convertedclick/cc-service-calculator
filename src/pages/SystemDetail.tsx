// src/pages/SystemDetail.tsx
//
// /systems/:id — one system: goal, owner, steps, revisions, and (kind='internal'
// only) an overhead-vs-estimate read, plus the Phase 6 drag-and-drop canvas
// (mounted at the bottom, its own window bar owns Tidy up/Propose/Unsaved).
// ZERO ClickUp writes happen from this page.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Copy,
  History,
  ListChecks,
  Plus,
  SquareKanban,
  Settings2,
  Trash2,
  User,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  MATERIALISE_LABEL,
  PLACEHOLDER_GOAL,
  SYSTEM_BANDS,
  SYSTEM_BAND_LABEL,
  SYSTEM_KIND_LABEL,
  systemLayer,
  useSystemDefinition,
  useSystemOverhead,
  useUpdateSystem,
  type SystemDefinitionWithJoins,
} from "@/hooks/useSystemDefinitions";
import { useCreateStep, useReorderStep, useSystemSteps, useUpdateStep } from "@/hooks/useProcessSteps";
import { useConnectSteps, useSystemEdges, useSystemSubSteps } from "@/hooks/useSystemCanvas";
import { DeleteStepDialog } from "@/components/systems/DeleteStepDialog";
import { SignalNoise, VerbSelect, verdict } from "@/components/systems/StepSignal";
import {
  useProposeRevision,
  usePublishRevision,
  useRequestChanges,
  useSystemRevisions,
} from "@/hooks/useSystemRevisions";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useDepartments } from "@/hooks/useDepartments";
import { memberColors, useTeam } from "@/hooks/useTeam";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, errorMessage, toggleInSet } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
// open_step_slot (0122) isn't in the generated Database types — same untyped
// escape hatch useRecurringServiceOptions uses.
import type { SupabaseClient } from "@supabase/supabase-js";
// The house sprint-point convention (1 point = 15 min). Reused rather than
// re-derived so a step's points read the same as a placement task's.
import { pointsFromHours } from "@/types/placement-tasks";
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
type StepRow = Database["public"]["Tables"]["process_steps"]["Row"];
type StepUpdate = Database["public"]["Tables"]["process_steps"]["Update"];
type SystemRevisionRow = Database["public"]["Tables"]["system_revisions"]["Row"];
type MaterialiseMode = Database["public"]["Enums"]["materialise_mode"];

// The label's icon twin — MATERIALISE_LABEL spells the same three modes out.
const MATERIALISE_ICON: Record<MaterialiseMode, LucideIcon> = {
  task: SquareKanban,
  checklist_item: ListChecks,
  none: CircleSlash,
};

// Where a step added from the "Add step" button lands relative to the one it
// continues from — roughly a block width plus a gap, so the auto-drawn link
// reads left-to-right instead of overlapping.
const NEXT_STEP_GAP_X = 280;

// Deliberately not imported from SystemBlockNode's `initials`: that module
// pulls in @xyflow/react, which is lazy-loaded precisely so it stays out of
// the main bundle.
function stepOwnerInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

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
    review_due_at: s.review_due_at ?? "",
    // The 0105 backfill stores a placeholder *string* in a not-null column, so
    // an unmapped system arrives with "TODO: set a goal for this system" as its
    // real value. Showing that as the field's content made the box look filled
    // in while "No goal set" stayed lit — blank it out and let the HTML
    // placeholder do its job; save() writes the sentinel back if it's left empty.
    goal_statement: s.goal_statement === PLACEHOLDER_GOAL ? "" : s.goal_statement,
    goal_metric: s.goal_metric ?? "",
    trigger_text: s.trigger_text ?? "",
    definition_of_done: s.definition_of_done ?? "",
    exceptions_md: s.exceptions_md ?? "",
  };
}

export function SystemDetail() {
  const { id } = useParams();
  const { data: system, isLoading } = useSystemDefinition(id);
  // A process's blocks are stages that carry procedures, not work that carries
  // hours — this flag is what splits the two behaviours on this page.
  const isProcess = system != null && systemLayer(system.kind) === "process";
  const { data: steps = [] } = useSystemSteps(id);
  const addStep = useCreateStep();
  const updateStep = useUpdateStep();
  const reorder = useReorderStep();
  const connect = useConnectSteps(id ?? "");
  // Both share a query key with the canvas, so on the Steps pane these are
  // cache reads, not extra round-trips. Needed here so the delete confirm can
  // name what it's about to take with the row.
  const { data: subSteps = [] } = useSystemSubSteps(steps.map((s) => s.id));
  const { data: edgeRows = [] } = useSystemEdges(id);
  const [deleteTarget, setDeleteTarget] = useState<StepRow | null>(null);
  // Which rows have their signal/noise questions open. State rather than a
  // native <details>: the toggle lives at the bottom of the row's right-hand
  // cluster and the panel opens under the row's left column, which no
  // <summary> can straddle.
  const [signalOpen, setSignalOpen] = useState<Set<string>>(new Set());

  // One creation path for both callers: the "Add step" button (no position, no
  // explicit source — chains off the last step) and the canvas dropping a
  // connection on empty space (its own position and source handle). For a
  // kind='service' system the step carries service_id too, so it shows up on
  // the service's Process flow as well and stays in one bucket of
  // process_steps_ordinal_idx.
  const createStep = useCallback(
    async (opts: {
      pos_x?: number;
      pos_y?: number;
      connectFrom?: string | null;
      sourceHandle?: string | null;
      title?: string;
      // Duplicate passes the source row's editable columns through; spread
      // after the defaults so a copy keeps its own materialise_as.
      fields?: StepUpdate;
      /** Land directly after this step instead of at the end of the list. */
      after?: StepRow;
    } = {}) => {
      if (!id) return null;
      const prev = opts.after ?? (steps.length > 0 ? steps[steps.length - 1] : null);
      const from = opts.connectFrom ?? prev?.id ?? null;
      const prevPos = prev && prev.pos_x != null && prev.pos_y != null ? { x: prev.pos_x, y: prev.pos_y } : null;
      const pos_x = opts.pos_x ?? (prevPos ? prevPos.x + NEXT_STEP_GAP_X : null);
      const pos_y = opts.pos_y ?? (prevPos ? prevPos.y : null);
      try {
        const row = {
          system_id: id,
          service_id: system?.service_id ?? null,
          title: opts.title ?? "New step",
          department_id: null,
          // Most steps in a procedure belong to whoever owns the procedure —
          // start there and let the avatar picker say otherwise.
          owner_id: system?.owner_id ?? null,
          estimated_hours: null,
          // A process block is a stage, not work: its hours and its ClickUp
          // artefact live on the procedures attached to it. The column default
          // ('checklist_item', 0121) would push a phantom artefact per stage
          // and double-count against the procedures underneath.
          ...(isProcess ? { materialise_as: "none" as const } : {}),
          pos_x: pos_x != null ? Math.round(pos_x) : null,
          pos_y: pos_y != null ? Math.round(pos_y) : null,
          ...opts.fields,
        };
        let step: StepRow;
        if (opts.after) {
          // Inserting mid-list means every later sibling shifts up one, and
          // process_steps_ordinal_idx is checked per row — so the shift runs
          // server-side (open_step_slot, 0122) and hands back the freed
          // ordinal. No retry branch: that ordinal is free by construction.
          const { data: ordinal, error } = await (supabase as unknown as SupabaseClient).rpc(
            "open_step_slot",
            { p_step_id: opts.after.id },
          );
          if (error) throw error;
          step = await addStep.mutateAsync({ ...row, ordinal: ordinal as number });
        } else {
          try {
            step = await addStep.mutateAsync({
              ...row,
              ordinal: steps.reduce((max, s) => Math.max(max, s.ordinal), 0) + 1,
            });
          } catch (e) {
            // process_steps_ordinal_idx is UNIQUE per scope, and `steps` is the
            // last render's data — two quick adds both compute the same next
            // ordinal and the second one 23505s. Re-read the real max and retry
            // once rather than making the user click again.
            if ((e as { code?: string })?.code !== "23505") throw e;
            const { data: last } = await supabase
              .from("process_steps")
              .select("ordinal")
              .eq("system_id", id)
              .is("parent_id", null)
              .order("ordinal", { ascending: false })
              .limit(1)
              .maybeSingle();
            step = await addStep.mutateAsync({ ...row, ordinal: (last?.ordinal ?? 0) + 1 });
          }
        }
        // A step nobody can reach isn't a step in a process — link it to
        // whatever it follows. Awaited so a failure here still surfaces.
        if (from) {
          await connect.mutateAsync({ source: from, target: step.id, sourceHandle: opts.sourceHandle ?? null });
        }
        // Mirrors clicking a Steps-list row: select + centre the new block on
        // the canvas so its details populate the Block Inspector immediately,
        // instead of leaving it unselected until the user clicks it by hand.
        setFocusStep({ id: step.id, nonce: Date.now() });
        return step;
      } catch (e) {
        toast.error((e as { message?: string })?.message || "Could not add step");
        return null;
      }
    },
    [id, steps, system?.service_id, system?.owner_id, isProcess, addStep, connect]
  );

  // Copy every editable column of the row — the config (verb, dept, owner,
  // hours, ClickUp mode, signal answers) is the point of duplicating. Identity,
  // ordinal and position are dropped; the copy lands directly after its
  // source, which is where you're looking when you click Duplicate.
  // Sub-steps aren't copied.
  function duplicateStep(step: StepRow) {
    const {
      id: _id,
      created_at: _created,
      updated_at: _updated,
      ordinal: _ordinal,
      pos_x: _x,
      pos_y: _y,
      ...fields
    } = step;
    void createStep({ after: step, fields: { ...fields, title: `${step.title} (copy)` } });
  }

  function patchStep(step: StepRow, patch: StepUpdate, revert?: () => void) {
    updateStep.mutate(
      { id: step.id, patch },
      {
        onError: (e) => {
          toast.error(`Could not save that: ${errorMessage(e)}`);
          revert?.();
        },
      }
    );
  }

  function renameStep(step: StepRow, raw: string, revert: () => void) {
    const value = raw.trim();
    if (value === step.title) return;
    if (!value) {
      toast.error("A step needs a title");
      revert();
      return;
    }
    patchStep(step, { title: value }, revert);
  }

  function saveHours(step: StepRow, raw: string, revert: () => void) {
    const value = raw.trim();
    if (!value) {
      if (step.estimated_hours == null) return;
      patchStep(step, { estimated_hours: null }, revert);
      return;
    }
    const parsed = Number(value);
    // process_steps_min_hours: null, or at least 0.25. Caught here so a typo
    // reads as a message rather than a 400 from Postgres.
    if (Number.isNaN(parsed) || parsed < 0.25) {
      toast.error("Hours must be blank or at least 0.25");
      revert();
      return;
    }
    if (parsed === step.estimated_hours) return;
    patchStep(step, { estimated_hours: parsed }, revert);
  }

  // Swap with the neighbour. The park ordinal has to be free in this scope's
  // bucket — max + 1 always is; see useReorderStep.
  function moveStep(index: number, direction: -1 | 1) {
    const a = steps[index];
    const b = steps[index + direction];
    if (!a || !b) return;
    reorder.mutate(
      {
        a: { id: a.id, ordinal: a.ordinal },
        b: { id: b.id, ordinal: b.ordinal },
        parkOrdinal: steps.reduce((max, s) => Math.max(max, s.ordinal), 0) + 1,
      },
      { onError: (e) => toast.error(`Could not reorder: ${errorMessage(e)}`) }
    );
  }

  const { data: depts = [] } = useDepartments();
  const { data: team = [] } = useTeam();
  const update = useUpdateSystem();
  const { data: revisions = [], isLoading: revisionsLoading } = useSystemRevisions(id);
  const { role } = useCurrentRole();
  // Anyone signed in can edit a procedure — that's the point of a shared
  // library. Approving a revision is the one admin/owner act (the
  // publish_system_revision RPC enforces it server-side too).
  const canApprove = role === "admin" || role === "owner";

  const deptById = useMemo(() => new Map(depts.map((d) => [d.id, d])), [depts]);
  const teamById = useMemo(() => new Map(team.map((t) => [t.id, t])), [team]);
  const colorById = useMemo(() => memberColors(team), [team]);
  const subCountByParent = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of subSteps) {
      if (s.parent_id) m.set(s.parent_id, (m.get(s.parent_id) ?? 0) + 1);
    }
    return m;
  }, [subSteps]);
  const edgeCountByStep = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edgeRows) {
      m.set(e.source_step_id, (m.get(e.source_step_id) ?? 0) + 1);
      m.set(e.target_step_id, (m.get(e.target_step_id) ?? 0) + 1);
    }
    return m;
  }, [edgeRows]);

  // Two panes behind the left rail. `seenSteps` keeps the Steps pane MOUNTED
  // once visited (hidden, not unmounted) — the canvas seeds node positions
  // exactly once per system and useSaveStepPosition deliberately never
  // invalidates ["process_steps"], so a remount would re-run auto-layout
  // against stale null positions and quietly move blocks that had just been
  // placed. It can't be mounted hidden from the start either: React Flow
  // measures 0×0 inside display:none and fitView would do nothing.
  const [pane, setPane] = useState<"setup" | "steps" | "revisions">("setup");
  const [seenSteps, setSeenSteps] = useState(false);
  useEffect(() => {
    if (pane === "steps") setSeenSteps(true);
  }, [pane]);

  const [form, setForm] = useState<FormState | null>(null);
  // Lifted so both RevisionsCard's own trigger AND the canvas window bar's
  // "Propose" button (P5's dialog, wired per this phase's task) can open the
  // same dialog instance.
  // Clicking a Steps row selects and centres that block on the canvas. The
  // nonce makes a repeat click on the same row re-centre.
  const [focusStep, setFocusStep] = useState<{ id: string; nonce: number } | null>(null);
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
      // goal_statement is not-null, so "cleared" is stored as the placeholder
      // sentinel — which is also what makes the "No goal set" badge light up.
      // Refusing the write instead (the old behaviour) left the field showing
      // whatever it had before and read as the edit being lost.
      if (system.goal_statement !== PLACEHOLDER_GOAL) {
        update.mutate(
          { id, patch: { goal_statement: PLACEHOLDER_GOAL } },
          { onError: (e) => toast.error(`Could not save: ${errorMessage(e)}`) }
        );
      }
      return;
    }
    const nullable = new Set<keyof FormState>([
      "band",
      "owner_id",
      "review_due_at",
      "goal_metric",
      "trigger_text",
      "definition_of_done",
      "exceptions_md",
    ]);
    const patchValue = value || (nullable.has(field) ? null : value);
    update.mutate(
      { id, patch: { [field]: patchValue } },
      { onError: (e) => toast.error(`Could not save: ${errorMessage(e)}`) },
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
    return <div className="p-6 text-body-medium text-m-on-surface-variant">Procedure not found.</div>;
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

  // Rounded on the way out: summing numeric(6,2) values in JS floats otherwise
  // surfaces things like 1.2500000000000002 in the total.
  const totalStepHours = Number(steps.reduce((sum, s) => sum + (s.estimated_hours ?? 0), 0).toFixed(2));
  const isUnmapped = system.goal_statement === PLACEHOLDER_GOAL;
  const latestRevision = revisions[0] ?? null;

  return (
    <div className="flex h-full">
      {/* Left rail — Setup is everything that *defines* the system; Steps is
          the work itself plus the canvas. Same rail shape as SowList and the
          productivity Team sidebar. */}
      <aside className="w-52 shrink-0 space-y-1 overflow-y-auto border-r border-m-outline-variant p-3">
        <Button variant="ghost" size="sm" asChild className="mb-1 w-full justify-start gap-1.5">
          <Link to="/systems"><ArrowLeft className="h-4 w-4" /> Systems</Link>
        </Button>
        <p className="truncate px-3 pb-1 text-label-small font-semibold uppercase tracking-widest text-m-on-surface-variant">
          {system.name}
        </p>
        <PaneRow icon={Settings2} label="Setup" active={pane === "setup"} onClick={() => setPane("setup")} />
        <PaneRow
          icon={Workflow}
          label="Steps"
          active={pane === "steps"}
          onClick={() => setPane("steps")}
          count={steps.length}
        />
        <PaneRow
          icon={History}
          label="Revisions"
          active={pane === "revisions"}
          onClick={() => setPane("revisions")}
          count={revisions.length}
        />
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className={cn("mx-auto max-w-4xl space-y-6", pane !== "setup" && "hidden")}>

        {/* Header */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  onBlur={(e) => save("name", e.target.value)}
                  aria-label="Procedure name"
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

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <FieldLabel label="Area">
                <select
                  value={form.band}
                  onChange={(e) => {
                    setForm({ ...form, band: e.target.value });
                    save("band", e.target.value);
                  }}
                  className="h-10 w-full rounded-md border border-m-outline bg-m-surface px-2 text-body-small text-m-on-surface"
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
                  className="h-10 w-full rounded-md border border-m-outline bg-m-surface px-2 text-body-small text-m-on-surface"
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
                  className="h-10"
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
              placeholder="What does this procedure exist to achieve?"
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
                placeholder="What kicks this procedure off?"
              />
            </FieldLabel>
            <FieldLabel label="Definition of done" stacked>
              <Textarea
                value={form.definition_of_done}
                onChange={(e) => setForm({ ...form, definition_of_done: e.target.value })}
                onBlur={(e) => save("definition_of_done", e.target.value)}
                rows={2}
                placeholder="How do we know this procedure's work is complete?"
              />
            </FieldLabel>
            <FieldLabel label="Exceptions" stacked>
              <Textarea
                value={form.exceptions_md}
                onChange={(e) => setForm({ ...form, exceptions_md: e.target.value })}
                onBlur={(e) => save("exceptions_md", e.target.value)}
                rows={2}
                placeholder="Edge cases this procedure doesn't cover"
              />
            </FieldLabel>
          </CardContent>
        </Card>

        {system.kind === "internal" && (
          <OverheadPanel system={system} totalStepHours={totalStepHours} />
        )}

        <div className="flex justify-end">
          <Button size="sm" className="gap-1.5" onClick={() => setPane("steps")}>
            Next: Steps <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        </div>

        {/* ── Steps ─────────────────────────────────────────────────────────
            Mounted on first visit and kept mounted after that (see `seenSteps`)
            so switching panes never remounts the canvas. */}
        {seenSteps && (
          <div className={cn("mx-auto max-w-5xl space-y-6", pane !== "steps" && "hidden")}>
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-title-medium">
                  Steps <span className="text-label-medium font-normal text-m-on-surface-variant">· {steps.length}</span>
                </CardTitle>
                <div className="flex items-center gap-3">
                  {totalStepHours > 0 && (
                    <span className="font-mono text-label-medium text-m-on-surface-variant">
                      {totalStepHours}h estimated
                      <span className="text-m-on-surface-variant/70"> · {pointsFromHours(totalStepHours)} pts</span>
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={addStep.isPending}
                    onClick={() => void createStep()}
                  >
                    <Plus className="h-4 w-4" /> Add step
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {steps.length === 0 ? (
                  <p className="px-5 pb-5 text-body-medium text-m-on-surface-variant">
                    No steps yet — add the first one to start the canvas.
                  </p>
                ) : (
                  <ol className="divide-y divide-m-outline-variant border-t border-m-outline-variant">
                    {steps.map((s, i) => {
                      const owner = s.owner_id ? teamById.get(s.owner_id) : null;
                      const inClickUp = s.materialise_as !== "none";
                      return (
                        <li
                          key={s.id}
                          className="flex w-full items-start gap-3 px-5 py-3 hover:bg-m-surface-container"
                        >
                          {/* self-center against the whole row, not the title
                              line — the row grows when Signal or noise opens
                              and the index should stay with its middle. */}
                          <div className="flex flex-none items-center gap-1.5 self-center">
                            <div className="flex flex-col">
                              <button
                                type="button"
                                aria-label={`Move "${s.title}" earlier`}
                                disabled={i === 0 || reorder.isPending}
                                onClick={() => moveStep(i, -1)}
                                className="text-m-on-surface-variant hover:text-m-on-surface disabled:opacity-25"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                aria-label={`Move "${s.title}" later`}
                                disabled={i === steps.length - 1 || reorder.isPending}
                                onClick={() => moveStep(i, 1)}
                                className="text-m-on-surface-variant hover:text-m-on-surface disabled:opacity-25"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            </div>
                            {/* Position in the list, not s.ordinal. Ordinals are
                                an ordering key under a UNIQUE index and go
                                sparse after a delete — showing them literally
                                made a four-step list read 1, 2, 3, 5. */}
                            <span className="w-5 text-center font-mono text-title-medium tabular-nums text-m-on-surface-variant">
                              {i + 1}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1 space-y-1.5">
                            {/* Rename in place. Focusing the field is also what
                                centres the block on the canvas — one gesture,
                                keyboard-reachable, and the ClickUp switch beside
                                it doesn't drag the viewport around as a side
                                effect. `key` re-seeds the uncontrolled input when
                                the title changes elsewhere (canvas inspector). */}
                            <div className="flex items-center gap-0.5">
                            {/* The verb reads as part of the sentence —
                                "Present · Share headlines" — so it sits on the
                                title line as a chip you click, with the real
                                <select> transparent on top of it. `title`
                                still stores the outcome only. */}
                            <span className="relative inline-flex flex-none">
                              <span
                                className={cn(
                                  "rounded-md px-1 py-0.5 text-title-medium font-normal hover:bg-m-surface-container-high",
                                  s.verb ? "text-m-on-surface-variant" : "text-m-outline",
                                )}
                              >
                                [{s.verb ?? "verb"}]
                              </span>
                              <VerbSelect
                                value={s.verb}
                                label={`Verb for "${s.title}"`}
                                onChange={(verb) => patchStep(s, { verb })}
                                className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
                              />
                            </span>
                            <input
                              key={s.title}
                              defaultValue={s.title}
                              aria-label={`Step ${i + 1} title`}
                              title="Rename this step — also centres it on the canvas"
                              onFocus={() => setFocusStep({ id: s.id, nonce: Date.now() })}
                              onBlur={(e) => {
                                const el = e.target;
                                renameStep(s, el.value, () => {
                                  el.value = s.title;
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                if (e.key === "Escape") {
                                  e.currentTarget.value = s.title;
                                  e.currentTarget.blur();
                                }
                              }}
                              className="w-full truncate rounded-md bg-transparent px-1 py-0.5 text-title-medium font-semibold text-m-on-surface outline-none hover:bg-m-surface-container-high focus:bg-m-surface focus:ring-1 focus:ring-m-primary"
                            />
                            </div>
                            {/* Everything about a step is editable from here;
                                the canvas inspector is the same fields on the
                                selected block, not the only way in. */}
                            <div className="flex flex-wrap items-center gap-1.5">
                              {/* The avatar IS the picker — a transparent
                                  native <select> sits on top of it, so the
                                  name stops eating 11rem of the row while
                                  keyboard, screen readers and the option list
                                  all still come free. */}
                              <span className="relative inline-flex flex-none">
                                {owner ? (
                                  <span
                                    className="grid h-8 w-8 place-items-center rounded-full text-label-small font-bold leading-none text-white"
                                    style={{ background: colorById.get(owner.id) }}
                                  >
                                    {stepOwnerInitials(owner.full_name)}
                                  </span>
                                ) : (
                                  <span className="grid h-8 w-8 place-items-center rounded-full border border-dashed border-m-outline text-m-on-surface-variant">
                                    <User className="h-4 w-4" />
                                  </span>
                                )}
                                <select
                                  value={s.owner_id ?? ""}
                                  aria-label={`Owner of "${s.title}"`}
                                  title={owner ? `${owner.full_name} — click to change` : "Unassigned — click to set an owner"}
                                  onChange={(e) => patchStep(s, { owner_id: e.target.value || null })}
                                  className="absolute inset-0 cursor-pointer appearance-none rounded-full bg-transparent text-transparent opacity-0"
                                >
                                  <option value="">— unassigned</option>
                                  {team.map((t) => (
                                    <option key={t.id} value={t.id}>{t.full_name}</option>
                                  ))}
                                </select>
                              </span>
                              <select
                                value={s.department_id ?? ""}
                                aria-label={`Department for "${s.title}"`}
                                onChange={(e) =>
                                  patchStep(s, { department_id: e.target.value || null })
                                }
                                className="h-8 max-w-[11rem] rounded-md border border-m-outline-variant bg-m-surface px-1.5 text-label-small text-m-on-surface"
                              >
                                <option value="">— no department</option>
                                {depts.map((d) => (
                                  <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                              </select>
                              <input
                                key={String(s.estimated_hours)}
                                defaultValue={s.estimated_hours ?? ""}
                                type="number"
                                step="0.25"
                                min="0.25"
                                placeholder="—"
                                aria-label={`Estimated hours for "${s.title}"`}
                                onBlur={(e) => {
                                  const el = e.target;
                                  saveHours(s, el.value, () => {
                                    el.value = s.estimated_hours != null ? String(s.estimated_hours) : "";
                                  });
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                }}
                                className="h-7 w-16 rounded-md border border-m-outline-variant bg-m-surface px-1.5 text-right font-mono text-label-small text-m-on-surface"
                              />
                              <span className="font-mono text-label-small text-m-on-surface-variant">
                                h
                                {s.estimated_hours != null && ` · ${pointsFromHours(s.estimated_hours)}pt`}
                              </span>
                            </div>
                            {/* The questions themselves, with no heading and
                                no summary line — the chevron at the bottom of
                                the row's icon cluster is the whole affordance. */}
                            {signalOpen.has(s.id) && (
                              <div className="pt-1.5">
                                <SignalNoise step={s} onPatch={(patch) => patchStep(s, patch)} />
                              </div>
                            )}
                          </div>
                          <div className="flex flex-none flex-col items-end gap-1 pt-1">
                            <div className="flex items-center gap-2">
                            {/* On by default (materialise_as defaults to
                                'checklist_item', 0121); off writes 'none', which
                                planMaterialisation skips on push while still
                                keeping the step in the flow. Toggling back on
                                restores the default, not 'task' — a step that
                                should be its own task is set in the inspector. */}
                            <Switch
                              checked={inClickUp}
                              aria-label={`Push "${s.title}" to ClickUp`}
                              title={
                                inClickUp
                                  ? "Goes to ClickUp on push"
                                  : "Skipped on push — stays part of the process here"
                              }
                              onCheckedChange={(on) =>
                                patchStep(s, { materialise_as: on ? "checklist_item" : "none" })
                              }
                            />
                            {/* What the step becomes in ClickUp, as the icon
                                it will be — the word took 7rem on every row to
                                say what a glyph says. The menu spells it out
                                with the same icons. */}
                            <Select
                              value={s.materialise_as}
                              onValueChange={(v) => patchStep(s, { materialise_as: v as MaterialiseMode })}
                            >
                              <SelectTrigger
                                aria-label={`What "${s.title}" becomes in ClickUp`}
                                title={MATERIALISE_LABEL[s.materialise_as]}
                                // [&>svg]:hidden drops the trigger's own chevron,
                                // which is a direct child svg — so the mode icon
                                // below is wrapped to survive it.
                                className={cn(
                                  "h-8 w-8 flex-none justify-center rounded-md border-0 bg-transparent p-0 hover:bg-m-surface-container-high [&>svg]:hidden",
                                  inClickUp ? "text-m-on-surface" : "text-m-outline",
                                )}
                              >
                                <span>
                                  {(() => {
                                    const Icon = MATERIALISE_ICON[s.materialise_as];
                                    return <Icon className="h-4 w-4" />;
                                  })()}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(MATERIALISE_ICON) as MaterialiseMode[]).map((mode) => {
                                  const Icon = MATERIALISE_ICON[mode];
                                  return (
                                    <SelectItem key={mode} value={mode}>
                                      <span className="flex items-center gap-2">
                                        <Icon className="h-4 w-4" />
                                        {MATERIALISE_LABEL[mode]}
                                      </span>
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            <button
                              type="button"
                              aria-label={`Add a step after "${s.title}"`}
                              title="Insert a new step after this one"
                              disabled={addStep.isPending}
                              onClick={() => void createStep({ after: s })}
                              className="rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface disabled:opacity-40"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Duplicate "${s.title}"`}
                              title="Duplicate this step"
                              disabled={addStep.isPending}
                              onClick={() => void duplicateStep(s)}
                              className="rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface disabled:opacity-40"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete "${s.title}"`}
                              title="Delete this step"
                              onClick={() => setDeleteTarget(s)}
                              className="rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-error-container hover:text-m-on-error-container"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            </div>
                            <button
                              type="button"
                              aria-label={`Signal or noise for "${s.title}"`}
                              title="Signal or noise — is this step worth keeping?"
                              aria-expanded={signalOpen.has(s.id)}
                              onClick={() => setSignalOpen((prev) => toggleInSet(prev, s.id))}
                              className="rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface"
                            >
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 transition-transform",
                                  signalOpen.has(s.id) && "rotate-180",
                                )}
                              />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
              {steps.length > 0 && (
                <div className="flex items-center justify-end gap-3 border-t border-m-outline-variant px-5 py-2.5 text-label-medium">
                  <span className="text-m-on-surface-variant">Total</span>
                  <span className="w-24 text-right font-mono font-semibold text-m-on-surface">
                    {totalStepHours}h
                    <span className="font-normal text-m-on-surface-variant">
                      {" "}
                      · {pointsFromHours(totalStepHours)}pt
                    </span>
                  </span>
                </div>
              )}
            </Card>

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
                <SystemCanvas
                  systemId={system.id}
                  systemName={system.name}
                  isProcess={isProcess}
                  triggerText={system.trigger_text}
                  // The 0105 backfill parks a sentence-long sentinel in this
                  // not-null column — blank it here or the Goal pill reads
                  // "TODO: set a goal for this system".
                  goalStatement={system.goal_statement === PLACEHOLDER_GOAL ? null : system.goal_statement}
                  onPropose={() => setProposeOpen(true)}
                  onCreateStep={createStep}
                  focusStepId={focusStep}
                />
              </Suspense>
            </Card>
          </div>
        )}

        {/* ── Revisions ─────────────────────────────────────────────────────── */}
        <div className={cn("mx-auto max-w-4xl space-y-6", pane !== "revisions" && "hidden")}>
          <RevisionsCard
            systemId={system.id}
            revisions={revisions}
            isLoading={revisionsLoading}
            canApprove={canApprove}
            deptById={deptById}
            teamById={teamById}
            onPropose={() => setProposeOpen(true)}
          />
        </div>
      </div>

      {/* Propose lives outside all three panes: the canvas window bar's
          button opens it while the Revisions pane is unmounted/hidden. */}
      <ProposeDialog
        systemId={system.id}
        steps={steps}
        open={proposeOpen}
        setOpen={setProposeOpen}
        reason={proposeReason}
        setReason={setProposeReason}
      />

      <DeleteStepDialog
        step={deleteTarget}
        subStepCount={deleteTarget ? subCountByParent.get(deleteTarget.id) ?? 0 : 0}
        edgeCount={deleteTarget ? edgeCountByStep.get(deleteTarget.id) ?? 0 : 0}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// One row of the left rail. Same shape as the productivity Team sidebar's
// rows so the two rails read as the same control.
function PaneRow({
  icon: Icon,
  label,
  active,
  count,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-label-large transition-colors",
        active
          ? "bg-m-primary-container font-semibold text-m-on-primary-container"
          : "text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
      )}
    >
      <Icon className="h-4 w-4 flex-none" />
      <span className="flex-1 truncate">{label}</span>
      {count != null && <span className="text-label-small tabular-nums opacity-60">{count}</span>}
    </button>
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

// Rendered once at page level, outside both panes — the Revisions card (Setup)
// and the canvas window bar (Steps) are never mounted at the same time, and a
// dialog that unmounts with its trigger simply wouldn't open from the other.
function ProposeDialog({
  systemId,
  steps,
  open,
  setOpen,
  reason,
  setReason,
}: {
  systemId: string;
  steps: StepRow[];
  open: boolean;
  setOpen: (open: boolean) => void;
  reason: string;
  setReason: (reason: string) => void;
}) {
  const propose = useProposeRevision();
  // Signal/noise is required, not optional: a revision is the moment the
  // procedure becomes what everyone follows, so no step reaches it unexamined.
  // 'pending' only — a Force keep/cut is an answer, and "Needs a look" (some
  // answered, none decisive) is a judgement someone already made.
  const unevaluated = steps.filter((s) => verdict(s).effective === "pending");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason("");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Propose a change to this procedure</DialogTitle>
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
            placeholder="Why is this procedure changing?"
          />
        </div>
        {unevaluated.length > 0 && (
          <p className="rounded-lg bg-m-error-container px-3 py-2 text-label-medium text-m-on-error-container">
            Answer signal or noise on {unevaluated.length} step
            {unevaluated.length === 1 ? "" : "s"} first: {unevaluated.map((s) => s.title).join(", ")}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!reason.trim() || unevaluated.length > 0 || propose.isPending}
            onClick={() => {
              propose.mutate(
                { systemId, reasonForChange: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success("Revision proposed");
                    setOpen(false);
                    setReason("");
                  },
                  onError: (e) => toast.error(`Could not propose revision: ${errorMessage(e)}`),
                }
              );
            }}
          >
            {propose.isPending ? "Proposing…" : "Propose"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  onPropose,
}: {
  systemId: string;
  revisions: SystemRevisionRow[];
  isLoading: boolean;
  canApprove: boolean;
  deptById: Map<string, DeptRow>;
  teamById: Map<string, TeamRow>;
  // The dialog itself lives in SystemDetail, not here: the canvas window bar
  // opens it from the Steps pane, where this card isn't mounted.
  onPropose: () => void;
}) {
  const publish = usePublishRevision();
  const requestChanges = useRequestChanges();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-title-medium">
          Revisions <span className="text-label-medium font-normal text-m-on-surface-variant">· {revisions.length}</span>
        </CardTitle>
        <Button size="sm" variant="outline" onClick={onPropose}>Propose changes</Button>
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
                  onError: (e) => toast.error(`Could not publish revision: ${errorMessage(e)}`),
                }
              )
            }
            onRequestChanges={(revisionId) =>
              requestChanges.mutate(
                { revisionId, systemId },
                {
                  onSuccess: () => toast.success("Sent back to draft"),
                  onError: (e) => toast.error(`Could not update revision: ${errorMessage(e)}`),
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
        <details open={rev.state === "proposed"} className="mt-2 rounded-lg border border-m-outline-variant">
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
                className="rounded-md bg-m-error-container px-2 py-1 text-label-small text-m-on-error-container line-through"
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
              <p key={s.id} className="rounded-md bg-m-tertiary-container px-2 py-1 text-label-small text-m-on-tertiary-container">
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
            <div key={c.id} className="rounded-lg bg-m-secondary-container px-2.5 py-1.5 text-m-on-secondary-container">
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
