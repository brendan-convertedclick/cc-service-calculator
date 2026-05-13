import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  pending_id: z.string().describe('pending_senders row UUID'),
  action: z.enum(['allow', 'block']).describe('Convert pending to allow or block rule'),
})
type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data: pending, error: pErr } = await supabase
      .from('pending_senders')
      .select('client_id, email')
      .eq('id', input.pending_id)
      .maybeSingle()
    if (pErr) throw new Error(pErr.message)
    if (!pending) throw new Error('Pending sender not found')

    const { error: ruleErr } = await supabase
      .from('client_sender_rules')
      .upsert(
        { client_id: pending.client_id, pattern: pending.email.toLowerCase(), mode: input.action },
        { onConflict: 'client_id,pattern' },
      )
    if (ruleErr) throw new Error(ruleErr.message)

    const { error: delErr } = await supabase
      .from('pending_senders')
      .delete()
      .eq('id', input.pending_id)
    if (delErr) throw new Error(delErr.message)

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ resolved: true, client_id: pending.client_id, email: pending.email, mode: input.action }),
        },
      ],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
