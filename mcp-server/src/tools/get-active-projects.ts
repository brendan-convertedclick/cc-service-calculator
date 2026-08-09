import { z } from 'zod'
import { supabase } from '../supabase.js'
import { guarded } from '../tool-result.js'

export const schema = z.object({
  client_id: z.string().describe('Client UUID to look up active projects for'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, project_code, status, created_at')
      .eq('client_id', input.client_id)
      .eq('status', 'in_progress')

    if (error) throw new Error(error.message)
    return data ?? []
  })
}
