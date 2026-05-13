import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  client_id: z.string().describe('Client UUID to look up active projects for'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, project_code, status, created_at')
      .eq('client_id', input.client_id)
      .eq('status', 'in_progress')

    if (error) throw new Error(error.message)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data ?? []) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
