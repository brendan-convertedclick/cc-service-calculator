// src/hooks/useWorkflowSteps.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ProcessStepInstance, ProcessStepHandoff } from '@/types/db'

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

export function useUpdateStepInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<Pick<ProcessStepInstance,
        'status' | 'started_at' | 'completed_at' | 'actual_hours' | 'blocked_reason' | 'assignee_id' | 'manual_override'
      >>
    }) => {
      const { data, error } = await supabase
        .from('process_step_instances')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['workflow-steps', data.project_id] })
      qc.invalidateQueries({ queryKey: ['workflow-handoffs', data.project_id] })
    },
  })
}
