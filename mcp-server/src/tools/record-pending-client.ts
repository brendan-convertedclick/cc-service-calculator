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

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('pending_clients')
      .upsert(
        {
          domain,
          sample_sender: input.sender,
          sample_subject: input.subject ?? null,
          last_seen_at: now,
          dismissed_at: null,
        },
        { onConflict: 'domain', ignoreDuplicates: false },
      )
      .select('id, seen_count')

    if (error) throw new Error(error.message)
    const row = (data ?? [])[0] ?? { id: null, seen_count: 1 }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: row.id, seen_count: row.seen_count }) }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
