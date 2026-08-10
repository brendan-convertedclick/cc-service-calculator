import { z } from 'zod'
import { supabase } from '../supabase.js'
import { guarded } from '../tool-result.js'

export const schema = z.object({
  brief_id: z.string().uuid().describe('UUID of the brief'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('brief_intelligence')
      .select('*')
      .eq('brief_id', input.brief_id)
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data
  })
}
