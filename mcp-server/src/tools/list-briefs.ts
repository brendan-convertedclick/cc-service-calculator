import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  client_id: z.string().optional().describe('Filter by client UUID'),
  status: z.string().optional().describe('Filter by status: new, triaged, needs_info, closed, spam'),
  intent_type: z.string().optional().describe('Filter by intent_type: new_brief, project_thread, retainer_thread, general_query, quick_response'),
  limit: z.number().int().min(1).max(100).default(20).describe('Max results (default 20)'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    let query = supabase
      .from('briefs')
      .select('id, raw_subject, sender_email, status, intent_type, created_at, message_count')

    if (input.client_id) query = query.eq('client_id', input.client_id) as typeof query
    if (input.status) query = query.eq('status', input.status) as typeof query
    if (input.intent_type) query = query.eq('intent_type', input.intent_type) as typeof query

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(input.limit ?? 20)

    if (error) throw new Error(error.message)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data ?? []) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
