import { z } from 'zod'
import { supabase } from '../supabase.js'
import { guarded } from '../tool-result.js'
import { APP_URL } from '../lookup.js'
import { taskInput, writeTasks, resolveTasks, lastTask, TASK_GAP_X } from '../procedures.js'

export const schema = taskInput.extend({
  system_id: z.string().uuid().describe('Procedure id from create-procedure, get-procedure or list-procedures'),
})

type Input = z.infer<typeof schema>

/**
 * Appends one task, with its checklist, to the end of an existing procedure
 * and chains it onto the task before it.
 *
 * Only the end: inserting mid-run shifts every later sibling's ordinal (the
 * `open_step_slot` RPC), and reordering is a drag in the editor rather than
 * something worth an argument here.
 */
export async function handler(input: Input) {
  return guarded(async () => {
    const { system_id, ...task } = input

    const { data: system, error } = await supabase
      .from('system_definitions')
      .select('id, service_id, owner_id')
      .eq('id', system_id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!system) throw new Error(`No procedure with id ${system_id}`)

    const resolved = await resolveTasks([task], system.owner_id)
    const previous = await lastTask(system_id)
    const [created] = await writeTasks(
      { system_id, service_id: system.service_id, owner_id: system.owner_id },
      [task],
      resolved,
      {
        startOrdinal: (previous?.ordinal ?? 0) + 1,
        previousTaskId: previous?.id ?? null,
        startX: previous?.pos_x != null ? previous.pos_x + TASK_GAP_X : 0,
      },
    )

    return {
      task_id: created.id,
      ordinal: created.ordinal,
      steps: task.steps?.length ?? 0,
      url: `${APP_URL}/systems/${system_id}`,
    }
  })
}
