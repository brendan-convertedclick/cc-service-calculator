import { z } from 'zod'
import { supabase } from '../supabase.js'
import { guarded } from '../tool-result.js'

export const schema = z.object({
  brief_ids: z.array(z.string()).min(1).describe('Brief UUIDs to act on'),
  action: z.enum(['archive', 'delete']),
})
type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  return guarded(async () => {
    if (input.action === 'archive') {
      const { error } = await supabase
        .from('briefs')
        .update({ status: 'archived' })
        .in('id', input.brief_ids)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase
        .from('briefs')
        .delete()
        .in('id', input.brief_ids)
      if (error) throw new Error(error.message)
    }
    return { affected: input.brief_ids.length, action: input.action }
  })
}
