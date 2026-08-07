// supabase/functions/_shared/system-materialise.ts
//
// Pure decision function for the P3 materialisation matrix (see
// docs/superpowers/specs/2026-08-05-systems-design.md, Phase 3). No fetch, no
// supabase client — push-to-clickup does the actual ClickUp calls; this file
// only decides which artefact each step produces. Operates on the steps of a
// single service/system at a time (a top-level step + its own sub-steps),
// so callers with several services call it once per service.

export type MaterialiseStep = {
  id: string;
  parent_id: string | null;
  ordinal: number;
  title: string;
  materialise_as: "task" | "checklist_item" | "none";
};

export type MaterialisePlan = {
  tasks: Array<{ stepId: string; title: string; checklist: string[] }>;
  serviceChecklist: string[]; // items stamped on the service × department task
  skipped: string[]; // step ids that produce no ClickUp artefact
};

/**
 * The matrix, exactly:
 *   top-level, materialise_as='task'           -> its own task; its sub-steps
 *                                                  become that task's checklist
 *                                                  regardless of their own
 *                                                  materialise_as (ignored).
 *   top-level, materialise_as='checklist_item' -> a checklist item on the
 *                                                  service × department task.
 *   top-level, materialise_as='none'           -> nothing.
 *   sub-step (any materialise_as, ignored)      -> always a checklist item on
 *                                                  its parent's task; if the
 *                                                  parent isn't 'task', it
 *                                                  rolls up as a sibling item
 *                                                  on the service × department
 *                                                  checklist instead.
 * An orphan sub-step (parent_id not present among `steps`) has nowhere to
 * roll up to, so it's treated as skipped rather than silently misfiled.
 * Everything is ordered by ordinal.
 */
export function planMaterialisation(steps: MaterialiseStep[]): MaterialisePlan {
  const sorted = [...steps].sort((a, b) => a.ordinal - b.ordinal);
  const byId = new Map(sorted.map((s) => [s.id, s]));

  const subStepsByParent = new Map<string, MaterialiseStep[]>();
  const orphans: MaterialiseStep[] = [];
  for (const s of sorted) {
    if (s.parent_id === null) continue;
    if (!byId.has(s.parent_id)) {
      orphans.push(s);
      continue;
    }
    const arr = subStepsByParent.get(s.parent_id) ?? [];
    arr.push(s);
    subStepsByParent.set(s.parent_id, arr);
  }

  const tasks: MaterialisePlan["tasks"] = [];
  const serviceChecklist: string[] = [];
  const skipped: string[] = [];

  for (const step of sorted) {
    if (step.parent_id !== null) continue; // handled below via subStepsByParent
    const subs = subStepsByParent.get(step.id) ?? [];

    if (step.materialise_as === "task") {
      tasks.push({ stepId: step.id, title: step.title, checklist: subs.map((s) => s.title) });
      continue;
    }

    if (step.materialise_as === "checklist_item") {
      serviceChecklist.push(step.title);
    } else {
      skipped.push(step.id);
    }
    // Parent isn't a task: its sub-steps roll up as siblings, not children.
    for (const sub of subs) serviceChecklist.push(sub.title);
  }

  for (const orphan of orphans) skipped.push(orphan.id);

  return { tasks, serviceChecklist, skipped };
}
