// supabase/functions/_shared/system-materialise.ts
//
// Pure decision function for the P3 materialisation matrix (see
// docs/superpowers/specs/2026-08-05-systems-design.md, Phase 3). No fetch, no
// supabase client — push-to-clickup does the actual ClickUp calls; this file
// only decides which artefact each step produces. Operates on the steps of a
// single service/system at a time (a top-level step + its own sub-steps),
// so callers with several services call it once per service.
//
// Since 0123 the two levels have names: a top-level row is a TASK and a child
// row is a STEP on that task's checklist. The matrix below is unchanged — it
// already described exactly that — but two things moved with the rename:
//
//   * A checklist entry carries its description, not just its title. A ClickUp
//     checklist item is a name and a tick with nowhere to put prose, so the
//     instructions have to be rendered into the parent task's description
//     instead; dropping them here is what made "working instructions" invisible
//     to the person actually doing the work.
//   * A step switched off (materialise_as 'none') is now honoured. It used to
//     be ignored on a child row, so the per-step ClickUp toggle in the editor
//     silently did nothing once steps became children.

export type MaterialiseStep = {
  id: string;
  parent_id: string | null;
  ordinal: number;
  title: string;
  description?: string | null;
  materialise_as: "task" | "checklist_item" | "none";
};

/** One line on a ClickUp checklist, plus the prose that belongs to it. */
export type ChecklistEntry = { title: string; description: string | null };

export type MaterialisePlan = {
  tasks: Array<{
    stepId: string;
    title: string;
    description: string | null;
    checklist: ChecklistEntry[];
  }>;
  serviceChecklist: ChecklistEntry[]; // items stamped on the service × department task
  skipped: string[]; // step ids that produce no ClickUp artefact
};

function entry(step: MaterialiseStep): ChecklistEntry {
  return { title: step.title, description: step.description ?? null };
}

/**
 * The matrix, exactly:
 *   top-level, materialise_as='task'           -> its own task; its sub-steps
 *                                                  become that task's checklist.
 *   top-level, materialise_as='checklist_item' -> a checklist item on the
 *                                                  service × department task.
 *   top-level, materialise_as='none'           -> nothing.
 *   sub-step, materialise_as='none'             -> nothing; it stays part of the
 *                                                  written procedure but is
 *                                                  skipped on push.
 *   sub-step, anything else                     -> a checklist item on its
 *                                                  parent's task; if the parent
 *                                                  isn't 'task', it rolls up as
 *                                                  a sibling item on the
 *                                                  service × department task
 *                                                  instead.
 * An orphan sub-step (parent_id not present among `steps`) has nowhere to
 * roll up to, so it's treated as skipped rather than silently misfiled.
 * Everything is ordered by ordinal.
 */
export function planMaterialisation(steps: MaterialiseStep[]): MaterialisePlan {
  const sorted = [...steps].sort((a, b) => a.ordinal - b.ordinal);
  const byId = new Map(sorted.map((s) => [s.id, s]));

  const subStepsByParent = new Map<string, MaterialiseStep[]>();
  const orphans: MaterialiseStep[] = [];
  const skipped: string[] = [];

  for (const s of sorted) {
    if (s.parent_id === null) continue;
    if (!byId.has(s.parent_id)) {
      orphans.push(s);
      continue;
    }
    // Switched off in the editor: still part of how the work is done, just not
    // something ClickUp needs to show.
    if (s.materialise_as === "none") {
      skipped.push(s.id);
      continue;
    }
    const arr = subStepsByParent.get(s.parent_id) ?? [];
    arr.push(s);
    subStepsByParent.set(s.parent_id, arr);
  }

  const tasks: MaterialisePlan["tasks"] = [];
  const serviceChecklist: ChecklistEntry[] = [];

  for (const step of sorted) {
    if (step.parent_id !== null) continue; // handled below via subStepsByParent
    const subs = subStepsByParent.get(step.id) ?? [];

    if (step.materialise_as === "task") {
      tasks.push({
        stepId: step.id,
        title: step.title,
        description: step.description ?? null,
        checklist: subs.map(entry),
      });
      continue;
    }

    if (step.materialise_as === "checklist_item") {
      serviceChecklist.push(entry(step));
    } else {
      skipped.push(step.id);
    }
    // Parent isn't a task: its sub-steps roll up as siblings, not children.
    for (const sub of subs) serviceChecklist.push(entry(sub));
  }

  for (const orphan of orphans) skipped.push(orphan.id);

  return { tasks, serviceChecklist, skipped };
}

/**
 * The working instructions for one ClickUp task, as markdown.
 *
 * A checklist item is a name and a tick — there is nowhere on it to say how the
 * thing is actually done. So everything written against the task and its steps
 * is rendered into the task's description, in step order, and the checklist
 * stays the tick list. Returns null when there is nothing to say, so the caller
 * can skip the update call entirely rather than stamping an empty description.
 *
 * Steps are NOT numbered here: Conductor numbers them across the whole
 * procedure, and a "4." against the second item of a two-item checklist reads
 * as a mistake to the person looking at it.
 */
export function renderHowTo(
  task: { title: string; description: string | null; checklist: ChecklistEntry[] },
  origin?: { label: string; url: string } | null,
): string | null {
  const parts: string[] = [];
  if (task.description?.trim()) parts.push(task.description.trim());

  for (const item of task.checklist) {
    if (!item.description?.trim()) continue;
    parts.push(`## ${item.title}\n\n${item.description.trim()}`);
  }

  if (parts.length === 0) return origin ? `[${origin.label}](${origin.url})` : null;
  if (origin) parts.push(`---\n\n[${origin.label}](${origin.url})`);
  return parts.join("\n\n");
}
