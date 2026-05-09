import { z } from 'zod'
import { supabase } from '../supabase.js'

const scopeSchema = z.object({
  enhanced_prose: z.string().describe('AI-generated prose summary of what is in scope'),
  in_scope_md: z.string().describe('Markdown bullet list of in-scope items'),
  out_of_scope_md: z.string().describe('Markdown bullet list of out-of-scope items'),
  open_questions_md: z.string().describe('Markdown bullet list of clarifying questions'),
  scope_type: z.enum(['new_brief', 'project_thread', 'retainer_thread', 'general_query']),
})

export const schema = z.object({
  brief_id: z.string().describe('UUID of the brief to update'),
  intent_type: z.enum(['new_brief', 'project_thread', 'retainer_thread', 'general_query', 'quick_response']),
  draft_reply: z.string().optional().describe('Draft reply text — populate for quick_response only'),
  scope: scopeSchema.optional().describe('Scope output — populate for all types except quick_response'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { error: briefError } = await supabase
      .from('briefs')
      .update({
        intent_type: input.intent_type,
        ...(input.draft_reply !== undefined ? { draft_reply: input.draft_reply } : {}),
      })
      .eq('id', input.brief_id)

    if (briefError) throw new Error(briefError.message)

    if (input.scope) {
      const { error: scopeError } = await supabase
        .from('scopes')
        .upsert(
          {
            brief_id: input.brief_id,
            enhanced_prose: input.scope.enhanced_prose,
            in_scope_md: input.scope.in_scope_md,
            out_of_scope_md: input.scope.out_of_scope_md,
            open_questions_md: input.scope.open_questions_md,
            scope_type: input.scope.scope_type,
          },
          { onConflict: 'brief_id' },
        )

      if (scopeError) throw new Error(scopeError.message)
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ updated: true }) }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
