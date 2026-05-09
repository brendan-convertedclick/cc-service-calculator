import { z } from 'zod'
import { supabase } from '../supabase.js'
import { fireAutoScope } from '../auto-scope.js'

export const schema = z.object({
  gmail_thread_id: z.string().describe('Gmail thread ID — used as dedup key'),
  subject: z.string().describe('Email subject line'),
  body: z.string().describe('Plain text email body'),
  sender_email: z.string().email().describe('Sender email address'),
  sender_name: z.string().optional().describe('Sender display name'),
  client_id: z.string().optional().describe('Client UUID from find-client; omit if sender is unknown'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    // Idempotency check
    const { data: existing } = await supabase
      .from('briefs')
      .select('id')
      .eq('gmail_thread_id', input.gmail_thread_id)
      .maybeSingle()

    if (existing) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ brief_id: existing.id, created: false }) }] }
    }

    // Insert new brief
    const { data: created, error } = await supabase
      .from('briefs')
      .insert({
        gmail_thread_id: input.gmail_thread_id,
        raw_subject: input.subject,
        raw_body: input.body,
        sender_email: input.sender_email,
        client_id: input.client_id ?? null,
        source: 'gmail_relay',
        status: 'new',
      })
      .select('id')
      .single()

    if (error || !created) throw new Error(error?.message ?? 'Insert failed')

    // Fire auto-scope in background — never blocks return
    fireAutoScope(created.id)

    return { content: [{ type: 'text' as const, text: JSON.stringify({ brief_id: created.id, created: true }) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
