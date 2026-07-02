import { z } from 'zod'
import { supabase } from '../supabase.js'
import { decide, type Rule } from '../sender-rules.js'
import { normalizeHost, hostMatches } from '../domain.js'

export const schema = z.object({
  email: z.string().describe('Sender email — full address'),
})
type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const email = input.email.toLowerCase()
    const domain = normalizeHost(email.split('@')[1] ?? '')

    // 1) Resolve the owning client via client_domains (multi-domain groups).
    const { data: cds, error: cdErr } = await supabase
      .from('client_domains')
      .select('client_id, domain')
    if (cdErr) throw new Error(cdErr.message)
    let clientId = (cds ?? []).find((cd) =>
      hostMatches(domain, normalizeHost(cd.domain as string)),
    )?.client_id as string | undefined

    // 2) Fall back to clients.primary_domain (which may be a bare host or full URL).
    if (!clientId) {
      const { data: clients, error: cErr } = await supabase
        .from('clients')
        .select('id, primary_domain')
        .not('primary_domain', 'is', null)
      if (cErr) throw new Error(cErr.message)
      clientId = (clients ?? []).find((c) =>
        hostMatches(domain, normalizeHost(c.primary_domain as string)),
      )?.id as string | undefined
    }

    if (!clientId) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ decision: 'unknown' }) }] }
    }

    const { data: rules, error: rErr } = await supabase
      .from('client_sender_rules')
      .select('id, pattern, mode')
      .eq('client_id', clientId)
    if (rErr) throw new Error(rErr.message)

    const result = decide(email, (rules ?? []) as Rule[])
    const payload = { ...result, client_id: clientId }

    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
