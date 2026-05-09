import { z } from 'zod'
import { supabase } from '../supabase.js'

const messageSchema = z.object({
  gmail_message_id: z.string().describe('Unique Gmail message ID — dedup key'),
  direction: z.enum(['inbound', 'outbound']).describe('inbound = from client, outbound = from team'),
  from_email: z.string().describe('Sender email address'),
  from_name: z.string().optional().describe('Sender display name'),
  to_emails: z.array(z.string()).default([]),
  cc_emails: z.array(z.string()).default([]),
  subject: z.string().optional().describe('Message subject line'),
  body_text: z.string().optional().describe('Plain text body'),
  sent_at: z.string().describe('ISO 8601 timestamp'),
})

export const schema = z.object({
  brief_id: z.string().describe('UUID of the parent brief'),
  messages: z.array(messageSchema).min(1).describe('Messages to sync — duplicates are silently skipped'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const rows = input.messages.map(m => ({
      brief_id: input.brief_id,
      gmail_message_id: m.gmail_message_id,
      direction: m.direction,
      from_email: m.from_email,
      from_name: m.from_name ?? null,
      to_emails: m.to_emails,
      cc_emails: m.cc_emails,
      subject: m.subject ?? null,
      body_text: m.body_text ?? null,
      sent_at: m.sent_at,
    }))

    const { data, error } = await supabase
      .from('brief_messages')
      .upsert(rows, { onConflict: 'gmail_message_id', ignoreDuplicates: true })
      .select('id')

    if (error) throw new Error(error.message)

    // PostgREST returns only inserted rows when ignoreDuplicates:true; null means 0 inserted
    const inserted = data?.length ?? 0
    const skipped = input.messages.length - inserted

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ inserted, skipped }) }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
