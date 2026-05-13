import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  client_id: z.string().describe('Client UUID'),
  pattern: z.string().describe('Full email or *@domain wildcard'),
  mode: z.enum(['allow', 'block']).optional().describe('Required unless delete=true'),
  note: z.string().optional(),
  delete: z.boolean().optional().describe('When true, remove the rule instead of upserting'),
})
type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const pattern = input.pattern.trim().toLowerCase()
    if (!pattern.includes('@')) throw new Error('Pattern must be an email or *@domain')

    if (input.delete) {
      const { error } = await supabase
        .from('client_sender_rules')
        .delete()
        .eq('client_id', input.client_id)
        .eq('pattern', pattern)
      if (error) throw new Error(error.message)
      return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true }) }] }
    }

    if (!input.mode) throw new Error('mode is required when not deleting')

    const { data, error } = await supabase
      .from('client_sender_rules')
      .upsert(
        { client_id: input.client_id, pattern, mode: input.mode, note: input.note ?? null },
        { onConflict: 'client_id,pattern' },
      )
      .select('id, client_id, pattern, mode, note')
      .single()
    if (error) throw new Error(error.message)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
