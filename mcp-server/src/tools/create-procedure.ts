import { z } from 'zod'
import { supabase } from '../supabase.js'
import { guarded } from '../tool-result.js'
import { APP_URL, resolvePerson, resolveService } from '../lookup.js'
import { taskInput, writeTasks, resolveTasks } from '../procedures.js'

export const schema = z.object({
  name: z.string().describe('Procedure name e.g. "Google Ads campaign build"'),
  goal_statement: z.string().describe('What this procedure is for, in one sentence. Required.'),
  service: z.string().optional().describe('Service name to attach this procedure to. Omit for a standalone reference procedure.'),
  owner: z.string().optional().describe('Team member name or email accountable for the procedure. Tasks inherit this owner.'),
  trigger_text: z.string().optional().describe('What starts this procedure'),
  definition_of_done: z.string().optional().describe('How you know it is finished'),
  tasks: z.array(taskInput).optional().describe('The tasks, in order. Each becomes one ClickUp task; its steps become that task\'s checklist.'),
})

type Input = z.infer<typeof schema>

/**
 * Writes a whole procedure in one call — the system, its tasks, each task's
 * checklist, and the hand-off chain between tasks.
 *
 * It lands as live rows, which is a *draft*: nothing reaches ClickUp until
 * somebody publishes a revision, and publishing is an admin/owner act behind
 * the `publish_system_revision` RPC. So this tool can safely be given to
 * anyone — the worst it can do is add a procedure somebody has to review.
 */
export async function handler(input: Input) {
  return guarded(async () => {
    const service_id = input.service ? await resolveService(input.service) : null
    const owner_id = input.owner ? await resolvePerson(input.owner) : null
    // Every name checked before the first row is written, so a misspelt
    // department fails with nothing created rather than a procedure with no
    // tasks in it.
    const resolved = await resolveTasks(input.tasks ?? [], owner_id)

    const { data: system, error } = await supabase
      .from('system_definitions')
      .insert({
        name: input.name,
        // A procedure's kind says what it hangs off: a service if one was
        // named, otherwise 'reference' — a procedure attached to nothing,
        // which is what the Systems list shows under Procedures.
        kind: service_id ? 'service' : 'reference',
        goal_statement: input.goal_statement,
        service_id,
        owner_id,
        expert_id: owner_id,
        trigger_text: input.trigger_text ?? null,
        definition_of_done: input.definition_of_done ?? null,
      })
      .select('id')
      .single()
    if (error || !system) throw new Error(error?.message ?? 'Could not create the procedure')

    const tasks = await writeTasks(
      { system_id: system.id, service_id, owner_id },
      input.tasks ?? [],
      resolved,
      { startOrdinal: 1 },
    )

    return {
      system_id: system.id,
      url: `${APP_URL}/systems/${system.id}`,
      tasks: tasks.length,
      steps: (input.tasks ?? []).reduce((n, t) => n + (t.steps?.length ?? 0), 0),
    }
  })
}
