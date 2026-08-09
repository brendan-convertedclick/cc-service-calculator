import { z } from 'zod'
import { supabase } from '../supabase.js'
import { fireAutoScope } from '../auto-scope.js'
import { decide, type Rule } from '../sender-rules.js'
import { guarded } from '../tool-result.js'

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
  return guarded(async () => {
    const { data: existing } = await supabase
      .from('briefs')
      .select('id')
      .eq('gmail_thread_id', input.gmail_thread_id)
      .maybeSingle()

    if (existing) {
      return { brief_id: existing.id, created: false }
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
        return { blocked: true, reason: 'sender_blocked', rule_id: ruleDecision.rule_id }
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
    // Uses the queue_pending_sender RPC to increment seen_count on repeat hits.
    if (input.client_id && ruleDecision?.decision === 'pending') {
      await supabase.rpc('queue_pending_sender', {
        p_client_id: input.client_id,
        p_email: input.sender_email,
        p_sample_subject: input.subject,
        p_sample_brief_id: created.id,
      })
    }

    fireAutoScope(created.id)

    return { brief_id: created.id, created: true }
  })
}
