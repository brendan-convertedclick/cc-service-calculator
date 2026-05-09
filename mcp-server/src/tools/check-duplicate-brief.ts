import { z } from 'zod'
import { supabase } from '../supabase.js'

export const schema = z.object({
  gmail_thread_id: z.string().describe('Gmail thread ID to check for duplicates'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { data, error } = await supabase
      .from('briefs')
      .select('id')
      .eq('gmail_thread_id', input.gmail_thread_id)
      .maybeSingle()

    if (error) throw new Error(error.message)
    const result = data ? { brief_id: data.id } : null
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
