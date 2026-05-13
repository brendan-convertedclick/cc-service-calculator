import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  client_id: z.string().describe('Client UUID'),
})
type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data, error } = await supabase
      .from('client_sender_rules')
      .select('id, client_id, pattern, mode, note, created_at')
      .eq('client_id', input.client_id)
      .order('mode')
    if (error) throw new Error(error.message)
    const rows = data ?? []
    const allow = rows.filter((r) => r.mode === 'allow')
    const blocked = rows.filter((r) => r.mode === 'block')
    return { content: [{ type: 'text' as const, text: JSON.stringify({ allow, blocked }) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
