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
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
