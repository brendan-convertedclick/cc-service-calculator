import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  client_id: z.string().describe('Client UUID to check for an active retainer brief'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data, error } = await supabase
      .from('briefs')
      .select('id, raw_subject, scopes(enhanced_prose)')
      .eq('client_id', input.client_id)
      .eq('intent_type', 'retainer_thread')
      .not('status', 'in', '("closed","spam")')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data) return { content: [{ type: 'text' as const, text: JSON.stringify(null) }] }

    const scope = Array.isArray(data.scopes) ? data.scopes[0] : data.scopes
    const result = {
      brief_id: data.id,
      subject: data.raw_subject,
      scope_summary: scope?.enhanced_prose ?? null,
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
