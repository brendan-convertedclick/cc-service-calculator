import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/types/db'

export type ProcessStepInstance = Tables<'process_step_instances'>

// process_step_handoffs is a DB view (supabase/migrations/0032) built from an
// inner join of process_step_instances on itself, filtered to rows where both
// `completed_at` and `started_at` are non-null — so every column it produces
// is always populated, even though the generated view type marks all of them
// nullable. Narrow that back to the columns' real guarantees here.
export type ProcessStepHandoff = {
  [K in keyof Tables<'process_step_handoffs'>]: NonNullable<Tables<'process_step_handoffs'>[K]>
}

export function useWorkflowSteps(projectId: string) {
  return useQuery({
    queryKey: ['workflow-steps', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('process_step_instances')
        .select(`
          *,
          department:departments(id, name, color),
          assignee:team_members(id, full_name)
        `)
        .eq('project_id', projectId)
        .order('ordinal')
      if (error) throw error
      return data as (ProcessStepInstance & {
        department: { id: string; name: string; color: string } | null
        assignee: { id: string; full_name: string } | null
      })[]
    },
    enabled: Boolean(projectId),
  })
}

export function useWorkflowHandoffs(projectId: string) {
  return useQuery({
    queryKey: ['workflow-handoffs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('process_step_handoffs')
        .select('*')
        .eq('project_id', projectId)
        .order('from_ordinal')
      if (error) throw error
      return data as ProcessStepHandoff[]
    },
    enabled: Boolean(projectId),
  })
}

