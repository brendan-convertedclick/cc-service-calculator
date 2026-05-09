import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { SOWLevel } from '@/types/db'

export function useSOWLevels() {
  return useQuery({
    queryKey: ['sow-levels'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sow_levels')
        .select('*')
        .order('priority')
      if (error) throw error
      return data as SOWLevel[]
    },
  })
}

export function useReorderSOWLevels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      for (let i = 0; i < orderedIds.length; i++) {
        const { error } = await supabase
          .from('sow_levels')
          .update({ priority: (i + 1) * 10 })
          .eq('id', orderedIds[i])
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sow-levels'] }),
  })
}

export function useCreateSOWLevel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (level: Omit<SOWLevel, 'id' | 'created_at'>) => {
      const { data, error } = await supabase
        .from('sow_levels')
        .insert(level)
        .select()
        .single()
      if (error) throw error
      return data as SOWLevel
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sow-levels'] }),
  })
}

export function useDeleteSOWLevel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sow_levels').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sow-levels'] }),
  })
}
