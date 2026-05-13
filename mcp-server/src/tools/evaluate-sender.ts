import { z } from 'zod'
import { supabase } from '../supabase.js'
import { decide, type Rule } from '../sender-rules.js'

export const schema = z.object({
  email: z.string().describe('Sender email — full address'),
})
type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const email = input.email.toLowerCase()
    const domain = email.split('@')[1] ?? ''

    const { data: client, error: cErr } = await supabase
      .from('clients')
      .select('id')
      .ilike('primary_domain', domain)
      .maybeSingle()
    if (cErr) throw new Error(cErr.message)
    if (!client) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ decision: 'unknown' }) }] }
    }

    const { data: rules, error: rErr } = await supabase
      .from('client_sender_rules')
      .select('id, pattern, mode')
      .eq('client_id', client.id)
    if (rErr) throw new Error(rErr.message)

    const result = decide(email, (rules ?? []) as Rule[])
    const payload = { ...result, client_id: client.id }

    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
