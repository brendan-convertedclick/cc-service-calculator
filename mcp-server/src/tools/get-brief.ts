import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  brief_id: z.string().describe('Brief UUID'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data, error } = await supabase
      .from('briefs')
      .select(`
        id, raw_subject, raw_body, sender_email, status,
        intent_type, draft_reply, created_at, message_count,
        scopes(enhanced_prose, in_scope_md, out_of_scope_md, open_questions_md, scope_type)
      `)
      .eq('id', input.brief_id)
      .single()

    if (error) throw new Error(error.message)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
