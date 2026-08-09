import { z } from 'zod'
import { supabase } from '../supabase.js'
import { normalizeHost, hostMatches } from '../domain.js'
import { guarded } from '../tool-result.js'

export const schema = z.object({
  email_domain: z.string().optional().describe('Sender email domain e.g. acme.co.za'),
  name: z.string().optional().describe('Client name (partial match)'),
}).refine((d) => d.email_domain || d.name, { message: 'Provide email_domain or name' })

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  return guarded(async () => {
    if (!input.email_domain) {
      // Name lookup — partial match.
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, wiki_path, primary_domain')
        .ilike('name', `%${input.name}%`)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ?? null
    }

    // Domain lookup. Normalise both sides and match exact host or subdomain in JS.
    const domain = normalizeHost(input.email_domain)

    // 1) client_domains (multi-domain groups) takes precedence.
    const { data: cds, error: cdError } = await supabase
      .from('client_domains')
      .select('domain, client:clients!inner(id, name, wiki_path, primary_domain)')
    if (cdError) throw new Error(cdError.message)
    const cdHit = (cds ?? []).find((cd) =>
      hostMatches(domain, normalizeHost(cd.domain as string)),
    )
    if (cdHit) {
      const client = Array.isArray(cdHit.client) ? cdHit.client[0] : cdHit.client
      return client ?? null
    }

    // 2) clients.primary_domain (may be a bare host or a full URL).
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, name, wiki_path, primary_domain')
      .not('primary_domain', 'is', null)
    if (error) throw new Error(error.message)

    const match = (clients ?? []).find((c) =>
      hostMatches(domain, normalizeHost(c.primary_domain as string)),
    )
    if (match) return match

    // Fallback: look up client via brief_messages history when no primary_domain matches
    const { data: msgs, error: msgError } = await supabase
      .from('brief_messages')
      .select('brief:briefs!inner(client:clients!inner(id, name, wiki_path, primary_domain))')
      .ilike('from_email', `%@${domain}`)
      .eq('direction', 'inbound')
      .limit(1)

    if (msgError) throw new Error(msgError.message)

    const first = msgs?.[0]
    const brief = Array.isArray(first?.brief) ? first?.brief[0] : first?.brief
    const client = Array.isArray(brief?.client) ? brief?.client[0] : brief?.client
    return client ?? null
  })
}
