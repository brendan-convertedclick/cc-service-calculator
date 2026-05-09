import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ClauseSchema, ClauseValue, ResolvedClause } from '@/types/db'

export function useClauseSchema() {
  return useQuery({
    queryKey: ['clause-schema'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clause_schema')
        .select('*')
        .order('section, sort_order')
      if (error) throw error
      return data as ClauseSchema[]
    },
  })
}

export function useClauseValuesForLevel(levelId: string, scopeId: string | null) {
  return useQuery({
    queryKey: ['clause-values', levelId, scopeId],
    queryFn: async () => {
      let q = supabase
        .from('clause_values')
        .select('*')
        .eq('level_id', levelId)
      if (scopeId) {
        q = q.eq('scope_id', scopeId)
      } else {
        q = q.is('scope_id', null)
      }
      const { data, error } = await q
      if (error) throw error
      return data as ClauseValue[]
    },
    enabled: Boolean(levelId),
  })
}

export function useResolvedClauses(context: {
  projectId?: string
  clientId?: string
  serviceId?: string
}) {
  return useQuery({
    queryKey: ['resolved-clauses', context],
    queryFn: async () => {
      const { data: schema } = await supabase
        .from('clause_schema')
        .select('key')
      if (!schema) return {}

      const resolved: Record<string, ResolvedClause> = {}
      await Promise.all(
        schema.map(async ({ key }) => {
          const { data, error } = await supabase.rpc('resolve_sow_clause', {
            p_clause_key: key,
            p_project_id: context.projectId ?? null,
            p_client_id:  context.clientId  ?? null,
            p_service_id: context.serviceId ?? null,
          })
          if (!error && data) resolved[key] = data as ResolvedClause
        })
      )
      return resolved
    },
  })
}

export function useUpsertClauseValue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (val: Omit<ClauseValue, 'id' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('clause_values')
        .upsert(
          { ...val, updated_at: new Date().toISOString() },
          { onConflict: 'clause_key,level_id,scope_id' }
        )
        .select()
        .single()
      if (error) throw error
      return data as ClauseValue
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['clause-values', vars.level_id] })
      qc.invalidateQueries({ queryKey: ['resolved-clauses'] })
    },
  })
}

export function useDeleteClauseValue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('clause_values').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clause-values'] })
      qc.invalidateQueries({ queryKey: ['resolved-clauses'] })
    },
  })
}
