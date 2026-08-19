import { z } from 'zod'
import { supabase } from './supabase.js'
import { resolveDepartment, resolvePerson } from './lookup.js'

/**
 * Writing a procedure the way the editor writes one.
 *
 * A procedure is a run of **tasks**, each holding **steps** (0123). A
 * top-level `process_steps` row is a task — one ClickUp task, owning the
 * name, department, owner and estimate. A child row is a step — one line on
 * that task's checklist, belonging to whoever owns the task.
 *
 * Two invariants a caller must not have to know about, so they live here:
 *
 *   * `materialise_as` defaults to 'checklist_item' in the column, which is
 *     right for the service-side editor and wrong here. A task is written as
 *     'task' and a step as 'checklist_item' explicitly.
 *   * A task nobody can reach isn't part of a flow, so consecutive tasks are
 *     joined by a `system_edges` row and laid out left-to-right — the canvas
 *     draws tasks horizontally and their steps vertically inside the card.
 *
 * Hours can go on the task, the steps, or both. The
 * `process_steps_rollup_hours` trigger only overwrites the task's hours with
 * the sum of its steps once at least one step actually has an hour value
 * (migration 0125) — a task whose steps are all unestimated keeps whatever
 * was set on the task directly. So the task's `estimated_hours` is always
 * worth sending, steps or no steps.
 */

/** Horizontal gap between task cards — matches NEXT_STEP_GAP_X in SystemDetail. */
export const TASK_GAP_X = 280

export const stepInput = z.object({
  title: z.string().describe('What the person does — one line on the checklist'),
  description: z.string().optional().describe('Markdown detail; pushed into the ClickUp task body under a heading'),
  estimated_hours: z.number().optional().describe('Hours for this step; the task total is the sum of its steps'),
})

export const taskInput = z.object({
  title: z.string().describe('Task name — this is the name the ClickUp task gets'),
  department: z.string().optional().describe('Department name e.g. "Design". Required before the task can push to ClickUp'),
  owner: z.string().optional().describe('Team member name or email; defaults to the procedure owner'),
  description: z.string().optional().describe('Markdown instructions for the whole task'),
  estimated_hours: z.number().optional().describe('Hours for the whole task. Kept as-is if its steps are left unestimated; overwritten by the sum of step hours once any step has one'),
  steps: z.array(stepInput).optional().describe('Checklist items, in order'),
})

export type TaskInput = z.infer<typeof taskInput>

type SystemContext = {
  system_id: string
  service_id: string | null
  owner_id: string | null
}

export type ResolvedTask = { department_id: string | null; owner_id: string | null }

/**
 * Turns every department and owner name into an id.
 *
 * Separate from the write, and called first, because a misspelt department is
 * the likeliest way one of these calls fails — and a procedure that exists
 * with none of its tasks is worse than one that was never created. Resolve
 * everything, then write.
 */
export async function resolveTasks(tasks: TaskInput[], fallbackOwner: string | null): Promise<ResolvedTask[]> {
  return Promise.all(
    tasks.map(async (t) => ({
      department_id: t.department ? await resolveDepartment(t.department) : null,
      owner_id: t.owner ? await resolvePerson(t.owner) : fallbackOwner,
    })),
  )
}

/**
 * Appends tasks (with their steps) to a system, starting at `startOrdinal`,
 * chained onto `previousTaskId` if there is one.
 *
 * Returns the created task rows in order.
 */
export async function writeTasks(
  ctx: SystemContext,
  tasks: TaskInput[],
  resolved: ResolvedTask[],
  opts: { startOrdinal: number; previousTaskId?: string | null; startX?: number },
): Promise<{ id: string; title: string; ordinal: number }[]> {
  if (tasks.length === 0) return []
  const startX = opts.startX ?? 0

  const { data: created, error } = await supabase
    .from('process_steps')
    .insert(
      tasks.map((t, i) => ({
        system_id: ctx.system_id,
        service_id: ctx.service_id,
        parent_id: null,
        ordinal: opts.startOrdinal + i,
        title: t.title,
        description: t.description ?? null,
        department_id: resolved[i].department_id,
        owner_id: resolved[i].owner_id,
        estimated_hours: t.estimated_hours ?? null,
        materialise_as: 'task' as const,
        pos_x: startX + i * TASK_GAP_X,
        pos_y: 0,
      })),
    )
    .select('id, title, ordinal')
  if (error || !created) throw new Error(error?.message ?? 'Could not create the tasks')

  const steps = tasks.flatMap((t, i) =>
    (t.steps ?? []).map((s, j) => ({
      system_id: ctx.system_id,
      service_id: ctx.service_id,
      parent_id: created[i].id,
      ordinal: j + 1,
      title: s.title,
      description: s.description ?? null,
      estimated_hours: s.estimated_hours ?? null,
      materialise_as: 'checklist_item' as const,
    })),
  )
  if (steps.length > 0) {
    const { error: stepError } = await supabase.from('process_steps').insert(steps)
    if (stepError) throw new Error(stepError.message)
  }

  const chain = opts.previousTaskId ? [opts.previousTaskId, ...created.map((c) => c.id)] : created.map((c) => c.id)
  const edges = chain.slice(0, -1).map((source, i) => ({
    system_id: ctx.system_id,
    source_step_id: source,
    target_step_id: chain[i + 1],
  }))
  if (edges.length > 0) {
    const { error: edgeError } = await supabase.from('system_edges').insert(edges)
    if (edgeError) throw new Error(edgeError.message)
  }

  return created
}

/** The last task in a procedure — what a newly appended task hangs off. */
export async function lastTask(systemId: string) {
  const { data, error } = await supabase
    .from('process_steps')
    .select('id, ordinal, pos_x')
    .eq('system_id', systemId)
    .is('parent_id', null)
    .order('ordinal', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as { id: string; ordinal: number; pos_x: number | null } | null
}
