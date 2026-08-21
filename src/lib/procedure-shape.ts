// The shape of a procedure: a run of tasks, each holding steps.
//
// A task is what ClickUp gets — it has an owner, a department, an estimate and
// a place in the blocked-by chain. A step is a line on that task's checklist;
// it belongs to whoever owns the task and cannot be handed to anyone else,
// because a ClickUp checklist item has no assignee anything can query.
//
// In the database that is the two-level nesting process_steps has had since
// 0104: a top-level row (parent_id null) is a task, a child row is a step.
// 0123 grouped the existing flat procedures into that shape.
//
// Everything here is pure so the numbering rule has one definition and one
// test, rather than being re-derived by the list, the canvas and the push.

export type TaskLike = { id: string; ordinal: number };
export type StepLike = { id: string; parent_id: string | null; ordinal: number };

export type NumberedStep<S> = { step: S; number: number };
export type TaskGroup<T, S> = {
  task: T;
  /** 1-based position in the run — the "Task 3" badge. */
  number: number;
  steps: NumberedStep<S>[];
};

/**
 * Pairs each task with its steps and hands out the two numbering schemes the
 * UI shows: tasks count 1..N, and steps count *straight through the whole
 * procedure* rather than restarting inside each task. So a procedure whose
 * second task holds two steps reads 1 / 2,3 / 4 — the number a person says out
 * loud ("I'm stuck on step 4") means one thing everywhere.
 *
 * Both are positions, never the stored `ordinal`: ordinals go sparse after a
 * delete and would render a four-step task as 1, 2, 3, 5.
 *
 * Steps whose parent isn't in `tasks` are dropped rather than guessed at — an
 * orphan has no task to be numbered inside of.
 */
export function groupProcedure<T extends TaskLike, S extends StepLike>(
  tasks: T[],
  steps: S[],
): TaskGroup<T, S>[] {
  const byParent = new Map<string, S[]>();
  for (const s of steps) {
    if (!s.parent_id) continue;
    const arr = byParent.get(s.parent_id) ?? [];
    arr.push(s);
    byParent.set(s.parent_id, arr);
  }

  let stepNumber = 0;
  return [...tasks]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((task, i) => ({
      task,
      number: i + 1,
      steps: (byParent.get(task.id) ?? [])
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((step) => ({ step, number: ++stepNumber })),
    }));
}

/**
 * What a task is worth. The DB keeps this on the task row itself (the
 * process_steps_rollup_hours trigger sums the children on every write), so
 * this only exists for the optimistic case where the UI has the children in
 * hand and doesn't want to wait for a refetch. A task with no steps carries
 * its own estimate, which is why the fallback isn't zero.
 */
export function taskHours(
  task: { estimated_hours: number | string | null },
  steps: { estimated_hours: number | string | null }[],
): number | null {
  // The task's own figure wins whenever it has one — that column is what the
  // rollup trigger writes, what the header totals, what ClickUp gets, and
  // what someone typed if they overrode the sum. Steps are the fallback for a
  // task that carries no estimate of its own. (Returning null whenever a task
  // had unestimated steps was the same bug 0125 fixed in the trigger — it
  // read "no hours" for every task estimated at task level, which is how most
  // of them are written.)
  if (task.estimated_hours != null) return Number(task.estimated_hours);
  const estimated = steps.filter((s) => s.estimated_hours != null);
  if (estimated.length === 0) return null;
  return estimated.reduce((sum, s) => sum + Number(s.estimated_hours), 0);
}

/**
 * A task can't be created in ClickUp without a department: the department
 * chooses the list the task is created in and fills its Work Stream field.
 * An owner is optional — an unassigned task still pushes.
 */
export function taskBlockedReason(task: { department_id: string | null }): string | null {
  return task.department_id ? null : "Pick a department — a task can't be created without one";
}

/**
 * Lays staged edits over the saved rows.
 *
 * Field edits on this page are held rather than written (there is a Save
 * button, not an autosave), so what the person sees has to be the saved row
 * plus whatever they have changed since — otherwise a rename appears to have
 * been rejected the moment the field loses focus.
 */
export function applyDraft<T extends { id: string }>(
  rows: T[],
  draft: Map<string, Partial<T>>,
): T[] {
  if (draft.size === 0) return rows;
  return rows.map((row) => {
    const patch = draft.get(row.id);
    return patch ? { ...row, ...patch } : row;
  });
}

/**
 * Drops staged edits whose row no longer exists.
 *
 * A step can be deleted while it has edits staged — from the task list, from
 * the canvas, or as a child cascaded off its deleted task. The edit stays in
 * the draft, so Save PATCHes a row that isn't there, PostgREST returns no row,
 * `.single()` 406s ("Cannot coerce the result to a single JSON object"), and
 * the draft can never drain: Save stays lit and leaving the page keeps warning.
 *
 * Returns the same Map when nothing is stale, so it can be fed straight to
 * setState without re-rendering.
 */
export function pruneDraft<P>(draft: Map<string, P>, liveIds: Set<string>): Map<string, P> {
  const stale = [...draft.keys()].filter((rowId) => !liveIds.has(rowId));
  if (stale.length === 0) return draft;
  const next = new Map(draft);
  for (const rowId of stale) next.delete(rowId);
  return next;
}
