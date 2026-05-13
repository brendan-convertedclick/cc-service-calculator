import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  client_id: z.string().optional().describe('When provided, scope to a single client'),
})
type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    let q = supabase
      .from('pending_senders')
      .select('id, client_id, email, sample_subject, sample_brief_id, last_seen_at, seen_count')
      .order('last_seen_at', { ascending: false })
    if (input.client_id) q = q.eq('client_id', input.client_id)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data ?? []) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
