import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  domain: z.string().describe('Sender domain (lowercased before upsert)'),
  sender: z.string().describe('Most recent sender email seen for this domain'),
  subject: z.string().optional().describe('Most recent subject line'),
})
type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const domain = input.domain.trim().toLowerCase()
    if (!domain) throw new Error('domain is required')

    const { data, error } = await supabase.rpc('queue_pending_client', {
      p_domain: domain,
      p_sender: input.sender,
      p_subject: input.subject ?? null,
    })

    if (error) throw new Error(error.message)
    const row = Array.isArray(data) ? data[0] : data
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ id: row?.id ?? null, seen_count: row?.seen_count ?? 1 }),
        },
      ],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
