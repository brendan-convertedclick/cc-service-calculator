import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { ClauseTable } from '@/components/sow/ClauseTable'
import { useSOWLevels } from '@/hooks/useSOWLevels'

export default function SOWFamilyPage() {
  const { familySlug } = useParams<{ familySlug: string }>()
  const { data: levels = [] } = useSOWLevels()

  const { data: masterSow, isLoading } = useQuery({
    queryKey: ['master-sow', familySlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('master_sows')
        .select('*')
        .eq('slug', familySlug!)
        .single()
      if (error) throw error
      return data
    },
    enabled: Boolean(familySlug),
  })

  const agencyLevel  = levels.find(l => l.level_type === 'agency')
  const serviceLevel = levels.find(l => l.level_type === 'service')

  const scopeIds: Record<string, string | null> = {}
  if (agencyLevel)  scopeIds[agencyLevel.id]  = null
  if (serviceLevel) scopeIds[serviceLevel.id] = masterSow?.id ?? null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        {isLoading ? (
          <div className="h-6 w-48 bg-white/10 rounded animate-pulse" />
        ) : (
          <>
            <h1 className="text-xl font-bold text-foreground">
              {masterSow?.title ?? familySlug}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Master Scope of Work — structured clauses. Edits here affect all projects using this
              service family unless overridden at client or project level.
            </p>
          </>
        )}
      </div>

      {levels.length > 0 ? (
        <ClauseTable scopeIds={scopeIds} />
      ) : (
        <p className="text-sm text-muted-foreground">Loading levels…</p>
      )}
    </div>
  )
}
