import { useQuery } from '@tanstack/react-query'
import type { PricingHealthData } from '@/types/pulse'

interface ProjectSummary {
  id: string
  client_id: string
  client_name: string
  total_actual: number
  total_planned: number
}

export function computePricingHealth(projects: ProjectSummary[]): PricingHealthData {
  const isCreep = (p: ProjectSummary) => p.total_planned > 0 && p.total_actual >= p.total_planned * 1.10

  const scopeCreepRate = projects.length > 0
    ? Math.round((projects.filter(isCreep).length / projects.length) * 100)
    : 0

  const byClientMap = new Map<string, { name: string; total: number; over: number }>()
  projects.forEach(p => {
    const existing = byClientMap.get(p.client_id) ?? { name: p.client_name, total: 0, over: 0 }
    byClientMap.set(p.client_id, {
      ...existing,
      total: existing.total + 1,
      over: existing.over + (isCreep(p) ? 1 : 0),
    })
  })

  return {
    scopeCreepRate,
    conversionRate: null,
    byClient: Array.from(byClientMap.entries()).map(([clientId, v]) => ({
      clientId,
      clientName: v.name,
      scopeCreepRate: v.total > 0 ? Math.round((v.over / v.total) * 100) : 0,
    })),
  }
}

export function usePulsePricingHealth(): PricingHealthData | null {
  const { data } = useQuery({
    queryKey: ['pulsePricingHealth'],
    queryFn: async () => {
      const { supabase } = await import('@/lib/supabase')
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
      // error intentionally ignored: Pulse dashboard tile, degrades to an
      // empty/zeroed widget rather than red-screening the whole Pulse page —
      // same convention across usePulseWipFunnel / usePulseRevenueTrend / usePulseRetainerBurn.
      const { data: projects } = await supabase
        .from('projects')
        .select('id, client_id, clients(name), project_actuals_current(actual_hours, planned_hours)')
        .eq('status', 'completed')
        .gte('completed_at', since)

      const mapped: ProjectSummary[] = (projects ?? []).map(p => {
        const actuals = (p.project_actuals_current as Array<{ actual_hours: number | null; planned_hours: number | null }>) ?? []
        return {
          id: p.id,
          client_id: p.client_id ?? '',
          client_name: (p.clients as { name: string } | null)?.name ?? 'Unknown',
          total_actual: actuals.reduce((s, a) => s + (a.actual_hours ?? 0), 0),
          total_planned: actuals.reduce((s, a) => s + (a.planned_hours ?? 0), 0),
        }
      })

      return computePricingHealth(mapped)
    },
    staleTime: 15 * 60 * 1000,
  })
  return data ?? null
}
