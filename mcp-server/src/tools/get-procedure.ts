import { z } from 'zod'
import { supabase } from '../supabase.js'
import { guarded } from '../tool-result.js'
import { APP_URL } from '../lookup.js'

export const schema = z.object({
  system_id: z.string().uuid().describe('Procedure id from list-procedures or create-procedure'),
})

type Input = z.infer<typeof schema>

type Row = {
  id: string
  parent_id: string | null
  ordinal: number
  title: string
  description: string | null
  estimated_hours: number | string | null
  materialise_as: string
  department: { name: string } | null
  owner: { full_name: string } | null
}

/**
 * The whole procedure as a person reads it: tasks 1..N, and steps numbered
 * straight through the run rather than restarting inside each task, so "step
 * 4" means the same thing here as it does on screen. Both are positions, not
 * the stored ordinal — ordinals go sparse after a delete.
 *
 * Mirrors `groupProcedure` in src/lib/procedure-shape.ts. It is eight lines
 * and lives in a different package; importing across the two would cost more
 * than it saves.
 */
export async function handler(input: Input) {
  return guarded(async () => {
    const { data: system, error } = await supabase
      .from('system_definitions')
      // `service` must name its FK: 0140's services.procedure_id gave
      // system_definitions a second relationship to services, and a bare
      // `service:services(name)` makes PostgREST answer the whole request with
      // 300/PGRST201 — which threw here on every call. This is the many-to-one
      // (the service a procedure hangs off), matching the single {name} shape
      // below; services_procedure_id_fkey is the one-to-many and returns an array.
      .select('id, name, kind, goal_statement, trigger_text, definition_of_done, owner:team_members!system_definitions_owner_id_fkey(full_name), service:services!system_definitions_service_id_fkey(name)')
      .eq('id', input.system_id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!system) return null

    const { data, error: stepError } = await supabase
      .from('process_steps')
      .select('id, parent_id, ordinal, title, description, estimated_hours, materialise_as, department:departments(name), owner:team_members(full_name)')
      .eq('system_id', input.system_id)
      .order('ordinal')
    if (stepError) throw new Error(stepError.message)

    const rows = (data ?? []) as unknown as Row[]
    const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

    let stepNumber = 0
    const tasks = rows
      .filter((r) => !r.parent_id)
      .map((task, i) => ({
        number: i + 1,
        task_id: task.id,
        title: task.title,
        department: one(task.department)?.name ?? null,
        owner: one(task.owner)?.full_name ?? null,
        estimated_hours: task.estimated_hours == null ? null : Number(task.estimated_hours),
        description: task.description,
        pushes_to_clickup: task.materialise_as === 'task',
        steps: rows
          .filter((r) => r.parent_id === task.id)
          .map((step) => ({
            number: ++stepNumber,
            step_id: step.id,
            title: step.title,
            description: step.description,
            estimated_hours: step.estimated_hours == null ? null : Number(step.estimated_hours),
          })),
      }))

    return {
      system_id: system.id,
      name: system.name,
      kind: system.kind,
      goal_statement: system.goal_statement,
      trigger_text: system.trigger_text,
      definition_of_done: system.definition_of_done,
      owner: one(system.owner as { full_name: string } | { full_name: string }[] | null)?.full_name ?? null,
      service: one(system.service as { name: string } | { name: string }[] | null)?.name ?? null,
      url: `${APP_URL}/systems/${system.id}`,
      tasks,
    }
  })
}
