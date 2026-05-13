import { z } from 'zod'
import { supabase } from '../supabase.js'
import { fireAutoScope } from '../auto-scope.js'
import { decide, type Rule } from '../sender-rules.js'

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
    const { data: existing } = await supabase
      .from('briefs')
      .select('id')
      .eq('gmail_thread_id', input.gmail_thread_id)
      .maybeSingle()

    if (existing) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ brief_id: existing.id, created: false }) }] }
    }

    // Per-client sender rule check (block wins). Only meaningful when client_id is set.
    let ruleDecision: ReturnType<typeof decide> | null = null
    if (input.client_id) {
      const { data: rules, error: rErr } = await supabase
        .from('client_sender_rules')
        .select('id, pattern, mode')
        .eq('client_id', input.client_id)
      if (rErr) throw new Error(rErr.message)
      ruleDecision = decide(input.sender_email, (rules ?? []) as Rule[])
      if (ruleDecision.decision === 'block') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ blocked: true, reason: 'sender_blocked', rule_id: ruleDecision.rule_id }) }],
        }
      }
    }

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

    // Queue unknown-on-known-domain senders for explicit approval.
    if (input.client_id && ruleDecision?.decision === 'pending') {
      await supabase
        .from('pending_senders')
        .upsert(
          {
            client_id: input.client_id,
            email: input.sender_email.toLowerCase(),
            sample_subject: input.subject,
            sample_brief_id: created.id,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'client_id,email' },
        )
    }

    fireAutoScope(created.id)

    return { content: [{ type: 'text' as const, text: JSON.stringify({ brief_id: created.id, created: true }) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
