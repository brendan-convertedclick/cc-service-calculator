import { z } from 'zod'
import { supabase } from '../supabase.js'
import { guarded } from '../tool-result.js'
import { APP_URL } from '../lookup.js'

/** A system's kind says what layer it belongs to: 'policy' and 'process' are
 *  their own thing, everything else is a procedure (see systemLayer in
 *  src/hooks/useSystemDefinitions.ts). */
const PROCEDURE_KINDS = ['service', 'recurring', 'internal', 'reference']

export const schema = z.object({
  search: z.string().optional().describe('Match against the procedure name'),
  layer: z.enum(['procedure', 'process', 'policy', 'any']).optional()
    .describe('Which layer to list. Defaults to procedure — the step-by-step ones.'),
  limit: z.number().int().min(1).max(200).optional().describe('Default 50'),
})

type Input = z.infer<typeof schema>

/** Everything documented, so a caller can find the procedure it means before writing to it. */
export async function handler(input: Input) {
  return guarded(async () => {
    const layer = input.layer ?? 'procedure'
    let q = supabase
      .from('system_definitions')
      .select('id, name, kind, goal_statement, owner:team_members!system_definitions_owner_id_fkey(full_name)')
      .is('archived_at', null)
      .order('name')
      .limit(input.limit ?? 50)

    if (layer === 'procedure') q = q.in('kind', PROCEDURE_KINDS)
    else if (layer !== 'any') q = q.eq('kind', layer)
    if (input.search) q = q.ilike('name', `%${input.search}%`)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    return (data ?? []).map((s) => {
      const owner = s.owner as { full_name: string } | { full_name: string }[] | null
      return {
        system_id: s.id,
        name: s.name,
        kind: s.kind,
        goal_statement: s.goal_statement,
        owner: (Array.isArray(owner) ? owner[0] : owner)?.full_name ?? null,
        url: `${APP_URL}/systems/${s.id}`,
      }
    })
  })
}
