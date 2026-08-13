// src/pages/SystemDetail.tsx
//
// /systems/:id — one system: goal, owner, steps, revisions, and (kind='internal'
// only) an overhead-vs-estimate read, plus the Phase 6 drag-and-drop canvas
// (mounted at the bottom, its own window bar owns Tidy up/Propose/Unsaved).
// ZERO ClickUp writes happen from this page.

import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  History,
  Plus,
  Save,
  Settings2,
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
import { useConnectSteps, useDisconnectSteps, useSystemEdges, useSystemSubSteps } from "@/hooks/useSystemCanvas";
import { DeleteStepDialog } from "@/components/systems/DeleteStepDialog";
import { TaskList } from "@/components/systems/TaskList";
import { verdict } from "@/components/systems/StepSignal";
import {
  useProposeRevision,
  usePublishRevision,
  useRequestChanges,
  useSystemRevisions,
} from "@/hooks/useSystemRevisions";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useDepartments } from "@/hooks/useDepartments";
import { memberColors, useTeam } from "@/hooks/useTeam";
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
} from "@/components/ui/dialog";
import { cn, errorMessage, toggleInSet } from "@/lib/utils";
import { parseStepHours } from "@/lib/step-hours";
import { applyDraft } from "@/lib/procedure-shape";
import { FieldHint } from "@/components/FieldHint";
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

// Where a step added from the "Add step" button lands relative to the one it
// continues from — roughly a block width plus a gap, so the auto-drawn link
// reads left-to-right instead of overlapping.
const NEXT_STEP_GAP_X = 280;

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
  const disconnect = useDisconnectSteps(id ?? "");
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
          title: opts.title ?? "New task",
          department_id: null,
          // Most steps in a procedure belong to whoever owns the procedure —
          // start there and let the avatar picker say otherwise.
          owner_id: system?.owner_id ?? null,
          estimated_hours: null,
          // A top-level row is a TASK — one ClickUp task (0123). The column
          // default ('checklist_item', 0121) still belongs to the service-side
          // editor, where a step is a line on the service x department task,
          // so it is overridden rather than changed.
          // A process block is a stage, not work: its hours and its ClickUp
          // artefact live on the procedures attached to it, so it materialises
          // as nothing and would otherwise double-count against them.
          materialise_as: isProcess ? ("none" as const) : ("task" as const),
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
  //
  // A task's steps come with it: duplicating "On-page SEO" to get a second pass
  // and finding it empty is not a copy of anything. A step duplicates alone.
  async function duplicateStep(row: StepRow) {
    const {
      id: _id,
      created_at: _created,
      updated_at: _updated,
      ordinal: _ordinal,
      pos_x: _x,
      pos_y: _y,
      ...fields
    } = row;

    if (row.parent_id) {
      await createSubStepRow(row.parent_id, { ...fields, title: `${row.title} (copy)` }, row);
      return;
    }

    const copy = await createStep({ after: row, fields: { ...fields, title: `${row.title} (copy)` } });
    if (!copy) return;
    const children = subSteps
      .filter((s) => s.parent_id === row.id)
      .sort((a, b) => a.ordinal - b.ordinal);
    for (const [i, child] of children.entries()) {
      const { id: _cid, created_at: _cc, updated_at: _cu, ordinal: _co, pos_x: _cx, pos_y: _cy, ...childFields } = child;
      try {
        await addStep.mutateAsync({ ...childFields, parent_id: copy.id, ordinal: i + 1 });
      } catch (e) {
        toast.error(`Copied the task but not all of its steps: ${errorMessage(e)}`);
        return;
      }
    }
  }

  // Field edits are STAGED, not written. Autosave-on-blur meant tabbing
  // through a task to read it could rewrite it, and there was no way to try a
  // wording and back out. Structural actions (add, delete, duplicate,
  // reorder, promote, fold) still write immediately — they change what the
  // canvas and the numbering are drawn from, and a half-applied structure is
  // not something a Save button can hold coherently.
  const [draft, setDraft] = useState<Map<string, StepUpdate>>(new Map());
  const dirty = draft.size > 0;

  function patchStep(step: StepRow, patch: StepUpdate) {
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(step.id, { ...(next.get(step.id) ?? {}), ...patch });
      return next;
    });
  }

  /** Returns true only if every staged edit landed — the caller uses that to
   *  decide whether it is safe to leave the page. */
  async function saveDraft(): Promise<boolean> {
    const failed = new Map<string, StepUpdate>();
    let saved = 0;
    for (const [rowId, patch] of draft) {
      try {
        await updateStep.mutateAsync({ id: rowId, patch });
        saved += 1;
      } catch (e) {
        failed.set(rowId, patch);
        toast.error(`Could not save one of the changes: ${errorMessage(e)}`);
      }
    }
    // Anything that failed stays staged, so Save is still lit and the work
    // isn't silently dropped.
    setDraft(failed);
    if (failed.size === 0) {
      toast.success(saved === 1 ? "Saved 1 change" : `Saved ${saved} changes`);
      return true;
    }
    return false;
  }

  function discardDraft() {
    setDraft(new Map());
  }

  const { pending, setPending, guard } = useUnsavedChanges(dirty);
  const navigate = useNavigate();

  // Leaving the Tasks pane is leaving the editor as far as the work is
  // concerned — the fields aren't rendered any more, so the staged edits would
  // sit there invisibly until something else cleared them.
  function switchPane(next: "setup" | "steps" | "revisions") {
    if (next === pane) return;
    guard(() => setPane(next));
  }

  function renameStep(step: StepRow, raw: string, revert: () => void) {
    const value = raw.trim();
    if (value === step.title) return;
    if (!value) {
      toast.error("Give this a name");
      revert();
      return;
    }
    patchStep(step, { title: value });
  }

  function saveHours(step: StepRow, raw: string, revert: () => void) {
    // parseStepHours owns process_steps_min_hours, so a typo reads as a
    // message rather than a 400 from Postgres — and the rule lives in one
    // place shared with the canvas inspector.
    const result = parseStepHours(raw);
    if (!result.ok) {
      toast.error(result.message);
      revert();
      return;
    }
    if (result.value === step.estimated_hours) return;
    patchStep(step, { estimated_hours: result.value });
  }

  // Swap with the neighbour. `siblings` is whichever bucket the row lives in —
  // the run of tasks, or one task's steps — because process_steps_ordinal_idx
  // is unique per (system, service, parent), so a step only ever competes with
  // its own siblings. The park ordinal has to be free in that bucket; max + 1
  // always is (see useReorderStep).
  function moveRow(row: StepRow, siblings: StepRow[], direction: -1 | 1) {
    const ordered = [...siblings].sort((a, b) => a.ordinal - b.ordinal);
    const i = ordered.findIndex((s) => s.id === row.id);
    const b = ordered[i + direction];
    if (i === -1 || !b) return;
    reorder.mutate(
      {
        a: { id: row.id, ordinal: row.ordinal },
        b: { id: b.id, ordinal: b.ordinal },
        parkOrdinal: ordered.reduce((max, s) => Math.max(max, s.ordinal), 0) + 1,
      },
      { onError: (e) => toast.error(`Could not reorder: ${errorMessage(e)}`) }
    );
  }

  // ── steps ────────────────────────────────────────────────────────────────
  // A step is a child row: no position, no edges, no owner of its own. It gets
  // ClickUp's checklist_item mode so the per-step push switch has something to
  // turn off (planMaterialisation honours 'none' on a child since 0123).
  async function createSubStepRow(parentId: string, fields: StepUpdate, after?: StepRow) {
    if (!id) return null;
    try {
      let ordinal: number;
      if (after) {
        // Everything below shifts up one, server-side — same slot-opening RPC
        // the task list uses, which scopes its shift by parent bucket.
        const { data, error } = await (supabase as unknown as SupabaseClient).rpc("open_step_slot", {
          p_step_id: after.id,
        });
        if (error) throw error;
        ordinal = data as number;
      } else {
        ordinal = subSteps
          .filter((s) => s.parent_id === parentId)
          .reduce((max, s) => Math.max(max, s.ordinal), 0) + 1;
      }
      const created = await addStep.mutateAsync({
        system_id: id,
        service_id: system?.service_id ?? null,
        parent_id: parentId,
        title: "New step",
        materialise_as: "checklist_item",
        ...fields,
        ordinal,
      });
      setFocusStep({ id: parentId, nonce: Date.now() });
      return created;
    } catch (e) {
      toast.error(`Could not add that step: ${errorMessage(e)}`);
      return null;
    }
  }

  function createSubStep(task: StepRow, after?: StepRow) {
    return createSubStepRow(task.id, {}, after);
  }

  // A step that turns out to be somebody else's job becomes a task: it lands
  // straight after the task it came out of, inherits that task's department and
  // owner as a starting point, and joins the hand-off chain.
  async function promoteStep(step: StepRow) {
    const parent = steps.find((t) => t.id === step.parent_id);
    if (!parent) return;
    try {
      const { data: ordinal, error } = await (supabase as unknown as SupabaseClient).rpc("open_step_slot", {
        p_step_id: parent.id,
      });
      if (error) throw error;
      await updateStep.mutateAsync({
        id: step.id,
        patch: {
          parent_id: null,
          ordinal: ordinal as number,
          materialise_as: "task",
          department_id: parent.department_id,
          owner_id: parent.owner_id,
          pos_x: parent.pos_x != null ? parent.pos_x + NEXT_STEP_GAP_X : null,
          pos_y: parent.pos_y,
        },
      });
      await connect.mutateAsync({ source: parent.id, target: step.id, sourceHandle: null });
      setFocusStep({ id: step.id, nonce: Date.now() });
    } catch (e) {
      toast.error(`Could not make that its own task: ${errorMessage(e)}`);
    }
  }

  // The reverse: this was never a hand-off, it is part of the task before it.
  // The task's own title survives as the first of the steps it brings across —
  // folding should not quietly delete something somebody wrote. Its edges go,
  // because a step is not a place the flow can pass through.
  async function foldTask(task: StepRow, into: StepRow) {
    const moving = subSteps
      .filter((s) => s.parent_id === task.id)
      .sort((a, b) => a.ordinal - b.ordinal);
    let next = subSteps
      .filter((s) => s.parent_id === into.id)
      .reduce((max, s) => Math.max(max, s.ordinal), 0);
    try {
      await updateStep.mutateAsync({
        id: task.id,
        patch: {
          parent_id: into.id,
          ordinal: ++next,
          materialise_as: "checklist_item",
          department_id: null,
          owner_id: null,
          pos_x: null,
          pos_y: null,
        },
      });
      for (const child of moving) {
        await updateStep.mutateAsync({ id: child.id, patch: { parent_id: into.id, ordinal: ++next } });
      }
      // Rejoin the chain across the gap the folded task leaves behind, then
      // drop the edges that pointed at it.
      const outgoing = edgeRows.filter((e) => e.source_step_id === task.id);
      for (const e of outgoing) {
        if (e.target_step_id === into.id) continue;
        try {
          await connect.mutateAsync({ source: into.id, target: e.target_step_id, sourceHandle: e.source_handle });
        } catch {
          // A duplicate edge is fine — it means the chain was already joined.
        }
      }
      for (const e of edgeRows) {
        if (e.source_step_id === task.id || e.target_step_id === task.id) {
          await disconnect.mutateAsync(e.id);
        }
      }
      setFocusStep({ id: into.id, nonce: Date.now() });
    } catch (e) {
      toast.error(`Could not fold that task in: ${errorMessage(e)}`);
    }
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

  // What the list renders: saved rows with the staged edits laid over them, so
  // an unsaved rename reads back as you typed it.
  // No useMemo: this sits below an early return, and applyDraft already hands
  // back the very same array when nothing is staged — which is every render
  // that isn't mid-edit.
  const draftTasks = applyDraft(steps, draft);
  const draftSteps = applyDraft(subSteps, draft);
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
        <PaneRow icon={Settings2} label="Setup" active={pane === "setup"} onClick={() => switchPane("setup")} />
        <PaneRow
          icon={Workflow}
          label="Tasks"
          active={pane === "steps"}
          onClick={() => switchPane("steps")}
          count={steps.length}
        />
        <PaneRow
          icon={History}
          label="Revisions"
          active={pane === "revisions"}
          onClick={() => switchPane("revisions")}
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
              <FieldLabel
                label="Area"
                hint="Which part of the business this belongs to — Attract, Convert, Deliver, Retain or Internal. It groups the library, nothing else."
              >
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

              <FieldLabel
                label="Owner"
                hint="The one person accountable for keeping this accurate — not everyone who runs it. They get asked when it changes."
              >
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

              <FieldLabel
                label="Review due"
                hint="When someone should check this is still how the work is actually done. Leave blank if it needs no reminder."
              >
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
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-title-medium">Goal</CardTitle>
              <FieldHint label="Goal">
                What this exists to achieve, in one sentence — the outcome, not the steps. e.g. "Posts go out on the right day with the right creative and caption".
              </FieldHint>
            </div>
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
              <div className="flex items-center gap-1.5">
                <Label htmlFor="goal-metric">Goal metric</Label>
                <FieldHint label="Goal metric">
                  How you'd know it's working, as a number you could actually check. Leave blank if there isn't one worth tracking.
                </FieldHint>
              </div>
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
            <FieldLabel
              label="Trigger"
              stacked
              hint="The event that means someone should start — not the first step. e.g. 'The client approves the copy captions'."
            >
              <Textarea
                value={form.trigger_text}
                onChange={(e) => setForm({ ...form, trigger_text: e.target.value })}
                onBlur={(e) => save("trigger_text", e.target.value)}
                rows={2}
                placeholder="What kicks this procedure off?"
              />
            </FieldLabel>
            <FieldLabel
              label="Definition of done"
              stacked
              hint="The finished state you can point at and agree on, not the last step. e.g. 'Posts are scheduled and the client has approved them'."
            >
              <Textarea
                value={form.definition_of_done}
                onChange={(e) => setForm({ ...form, definition_of_done: e.target.value })}
                onBlur={(e) => save("definition_of_done", e.target.value)}
                rows={2}
                placeholder="How do we know this procedure's work is complete?"
              />
            </FieldLabel>
            <FieldLabel
              label="Exceptions"
              stacked
              hint="Situations this does NOT cover, so nobody follows it into the wrong job. e.g. 'Paid ad creative — that has its own procedure'."
            >
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
          <Button size="sm" className="gap-1.5" onClick={() => switchPane("steps")}>
            Next: Tasks <ArrowRight className="h-4 w-4" />
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
                  Tasks{" "}
                  <span className="text-label-medium font-normal text-m-on-surface-variant">
                    · {steps.length} · {subSteps.length} step{subSteps.length === 1 ? "" : "s"}
                  </span>
                </CardTitle>
                <div className="flex items-center gap-3">
                  {totalStepHours > 0 && !dirty && (
                    <span className="font-mono text-label-medium text-m-on-surface-variant">
                      {totalStepHours}h estimated
                      <span className="text-m-on-surface-variant/70"> · {pointsFromHours(totalStepHours)} pts</span>
                    </span>
                  )}
                  {dirty && (
                    <>
                      <span className="font-mono text-label-medium text-m-primary">
                        {draft.size} unsaved change{draft.size === 1 ? "" : "s"}
                      </span>
                      <Button size="sm" variant="ghost" onClick={discardDraft} disabled={updateStep.isPending}>
                        Discard
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!dirty || updateStep.isPending}
                    onClick={() => void saveDraft()}
                  >
                    <Save className="h-4 w-4" />
                    {updateStep.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={addStep.isPending}
                    onClick={() => void createStep()}
                  >
                    <Plus className="h-4 w-4" /> Add task
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <TaskList
                  tasks={draftTasks}
                  steps={draftSteps}
                  depts={depts}
                  team={team}
                  colorById={colorById}
                  busy={addStep.isPending || reorder.isPending}
                  signalOpen={signalOpen}
                  onToggleSignal={(id) => setSignalOpen((prev) => toggleInSet(prev, id))}
                  onFocus={(id) => setFocusStep({ id, nonce: Date.now() })}
                  onAddTask={(after) => void createStep({ after })}
                  onAddStep={(task, after) => void createSubStep(task, after)}
                  onPatch={patchStep}
                  onRename={renameStep}
                  onHours={saveHours}
                  onDuplicate={duplicateStep}
                  onDelete={setDeleteTarget}
                  onMove={moveRow}
                  onPromote={promoteStep}
                  onFold={foldTask}
                />
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
                  onAddStep={(task) => void createSubStep(task)}
                  onDuplicateTask={(task) => void duplicateStep(task)}
                  onInsertTaskAfter={(task) => void createStep({ after: task })}
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

      {/* The exit interview. `beforeunload` covers the tab closing; this
          covers every link and pane switch inside the app, which that event
          never sees. */}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {draft.size} unsaved change{draft.size === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              Leaving now throws them away. Save them first, or discard them and go.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Stay here
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const exit = pending;
                discardDraft();
                setPending(null);
                if (exit?.kind === "href") navigate(exit.href);
                else exit?.run();
              }}
            >
              Discard and leave
            </Button>
            <Button
              disabled={updateStep.isPending}
              onClick={() => {
                const exit = pending;
                setPending(null);
                void saveDraft().then((ok) => {
                  // A failed save keeps you here — leaving would drop exactly
                  // the edits that could not be written.
                  if (!ok) return;
                  if (exit?.kind === "href") navigate(exit.href);
                  else exit?.run();
                });
              }}
            >
              Save and leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
  hint,
  children,
}: {
  label: string;
  stacked?: boolean;
  /** One sentence on what belongs in the field, shown on hover/focus. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1", stacked && "space-y-1.5")}>
      <div className="flex items-center gap-1.5">
        <Label className="text-label-small text-m-on-surface-variant">{label}</Label>
        {hint && <FieldHint label={label}>{hint}</FieldHint>}
      </div>
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
