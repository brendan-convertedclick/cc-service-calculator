import { z } from 'zod'
import { supabase } from '../supabase.js'
import { evaluatePattern } from '../sender-rules.js'
import { guarded } from '../tool-result.js'

export const schema = z.object({
  client_id: z.string().describe('Client UUID'),
  pattern: z.string().describe('Full email or *@domain wildcard'),
})
type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('briefs')
      .select('id, raw_subject, sender_email, received_at, status')
      .eq('client_id', input.client_id)
      .order('received_at', { ascending: false })
    if (error) throw new Error(error.message)

    const briefs = (data ?? []).filter((b) => {
      if (!b.sender_email) return false
      return evaluatePattern(input.pattern, b.sender_email)
    })

    return { briefs }
  })
}
