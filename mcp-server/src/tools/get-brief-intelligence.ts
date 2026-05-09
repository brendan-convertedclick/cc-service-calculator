import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  brief_id: z.string().uuid().describe('UUID of the brief'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data, error } = await supabase
      .from('brief_intelligence')
      .select('*')
      .eq('brief_id', input.brief_id)
      .maybeSingle()

    if (error) throw new Error(error.message)

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
