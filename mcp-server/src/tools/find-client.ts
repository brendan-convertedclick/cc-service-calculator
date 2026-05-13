import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  email_domain: z.string().optional().describe('Sender email domain e.g. acme.co.za'),
  name: z.string().optional().describe('Client name (partial match)'),
}).refine((d) => d.email_domain || d.name, { message: 'Provide email_domain or name' })

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  const field = input.email_domain ? 'primary_domain' : 'name'
  const value = (input.email_domain ?? input.name)!

  try {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, wiki_path, primary_domain')
      .ilike(field, `%${value}%`)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (data) return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }

    // Fallback: look up client via brief_messages history when primary_domain isn't set
    if (input.email_domain) {
      const { data: msgs, error: msgError } = await supabase
        .from('brief_messages')
        .select('brief:briefs!inner(client:clients!inner(id, name, wiki_path, primary_domain))')
        .ilike('from_email', `%@${input.email_domain}`)
        .eq('direction', 'inbound')
        .limit(1)

      if (msgError) throw new Error(msgError.message)

      const first = msgs?.[0]
      const brief = Array.isArray(first?.brief) ? first?.brief[0] : first?.brief
      const client = Array.isArray(brief?.client) ? brief?.client[0] : brief?.client
      return { content: [{ type: 'text' as const, text: JSON.stringify(client ?? null) }] }
    }

    return { content: [{ type: 'text' as const, text: JSON.stringify(null) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
