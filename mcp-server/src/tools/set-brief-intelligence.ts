import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  brief_id:             z.string().uuid().describe('UUID of the brief this intelligence belongs to'),
  summary:              z.string().optional().describe('2–3 sentence synthesis in client language'),
  business_objective:   z.string().optional().describe('What success looks like for the client'),
  client_context_snap:  z.unknown().optional().describe('Snapshot of wiki client context at generation time'),
  requirements:         z.unknown().optional().describe('Array of {text, interpretation, mapped_service_ids, confidence, coverage_reason?, expected_disposition?}'),
  assumed_exclusions:   z.unknown().optional().describe('Array of {item_title, assumption, reason, mapped_services?} — adjacent work the client likely assumes is bundled but is not included'),
  suggested_services:   z.unknown().optional().describe('Array of {service_id, qty, confidence, reasoning} — quote-builder ready rollup'),
  work_breakdown:       z.unknown().optional().describe('Array of department breakdowns with tasks and hours'),
  total_human_hours_low:  z.number().optional(),
  total_human_hours_mid:  z.number().optional(),
  total_human_hours_high: z.number().optional(),
  total_ai_hours:         z.number().optional(),
  estimated_price_cents:  z.number().int().optional(),
  confidence_level:     z.enum(['low','medium','high']).optional(),
  open_questions:       z.unknown().optional().describe('Array of {question, context}'),
  inferred_start_date:  z.string().optional().describe('ISO date string'),
  inferred_deadline:    z.string().optional().describe('ISO date string'),
  priority_tier:        z.enum(['urgent','standard','flexible']).optional(),
  pipeline_version:     z.string().optional(),
  services_snapshot:    z.unknown().optional(),
  audit_trail_entry:    z.object({
    stage:        z.string(),
    completed_at: z.string(),
    duration_ms:  z.number().optional(),
    confidence:   z.number().optional(),
    notes:        z.string().optional(),
  }).optional().describe('Single audit trail entry to append — appended, not replaced'),
})

type Input = z.infer<typeof schema>

// Some MCP callers JSON.stringify array/object payloads before sending. JSONB columns
// then store them as JSON-typed strings rather than arrays/objects, which crashes the
// UI on `.map`. Parse strings back to their structured form at the boundary.
function parseIfJsonString(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const trimmed = v.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return v
  try { return JSON.parse(trimmed) } catch { return v }
}

const JSON_FIELDS = ['client_context_snap', 'requirements', 'suggested_services', 'assumed_exclusions', 'work_breakdown', 'open_questions', 'services_snapshot'] as const

export async function handler(input: Input) {
  try {
    const { audit_trail_entry, ...fields } = input
    for (const k of JSON_FIELDS) {
      if (k in fields) (fields as Record<string, unknown>)[k] = parseIfJsonString((fields as Record<string, unknown>)[k])
    }

    // Sequential append — the intake orchestrator runs stages sequentially so
    // concurrent calls to this tool on the same brief_id are not expected in V1.
    // If parallel stage execution is added, replace with a Postgres jsonb || update.
    let existingAuditTrail: unknown[] = []
    if (audit_trail_entry) {
      const { data: existing } = await supabase
        .from('brief_intelligence')
        .select('audit_trail')
        .eq('brief_id', input.brief_id)
        .maybeSingle()
      existingAuditTrail = (existing?.audit_trail as unknown[]) ?? []
    }

    const upsertPayload = {
      ...fields,
      updated_at: new Date().toISOString(),
      ...(audit_trail_entry
        ? { audit_trail: [...existingAuditTrail, audit_trail_entry] }
        : {}),
    }

    const { data, error } = await supabase
      .from('brief_intelligence')
      .upsert(upsertPayload, { onConflict: 'brief_id' })
      .select('id, brief_id, am_status')
      .single()

    if (error || !data) throw new Error(error?.message ?? 'Upsert failed')

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: data.id,
        brief_id: data.brief_id,
        am_status: data.am_status,
      }) }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
