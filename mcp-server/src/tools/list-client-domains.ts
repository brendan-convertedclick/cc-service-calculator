import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({})

export async function handler(_input: z.infer<typeof schema>) {
  try {
    const domains = new Set<string>()

    // Domains seen in past inbound emails attributed to a known client
    const { data: messages, error: msgError } = await supabase
      .from('brief_messages')
      .select('from_email, brief:briefs!inner(client_id)')
      .eq('direction', 'inbound')
      .not('from_email', 'is', null)

    if (msgError) throw new Error(msgError.message)

    for (const msg of messages ?? []) {
      const brief = Array.isArray(msg.brief) ? msg.brief[0] : msg.brief
      if (!brief?.client_id) continue
      const match = (msg.from_email as string).match(/@(.+)$/)
      if (match) domains.add(match[1].toLowerCase())
    }

    // Manually configured primary domains
    const { data: clients, error: clientError } = await supabase
      .from('clients')
      .select('primary_domain')
      .not('primary_domain', 'is', null)

    if (clientError) throw new Error(clientError.message)

    for (const c of clients ?? []) {
      if (c.primary_domain) domains.add((c.primary_domain as string).toLowerCase())
    }

    const result = [...domains].sort()
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
