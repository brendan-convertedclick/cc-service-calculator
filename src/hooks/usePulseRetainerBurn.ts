import { useQuery } from '@tanstack/react-query'
import type { RetainerBurnRow } from '@/types/pulse'

interface ProjectRow {
  id: string
  engagement_type: string
  retainer_hours_target: number | null
  retainer_monthly_fee_cents: number | null
  client_name: string
}

interface ActualRow {
  project_id: string | null
  actual_hours: number | null
}

export function computeRetainerBurn(
  projects: ProjectRow[],
  actuals: ActualRow[],
  today: Date,
): RetainerBurnRow[] {
  const retainers = projects.filter(p => p.engagement_type === 'retainer' && p.retainer_hours_target)
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const dayOfMonth = today.getDate()
  const daysLeft = daysInMonth - dayOfMonth

  return retainers.map(p => {
    const target = p.retainer_hours_target!
    const fee = p.retainer_monthly_fee_cents ?? 0
    const used = actuals
      .filter(a => a.project_id === p.id)
      .reduce((s, a) => s + (a.actual_hours ?? 0), 0)

    const burnPct = Math.round((used / target) * 100)
    const pace = dayOfMonth > 0 ? (used / dayOfMonth) * daysInMonth : 0
    const projectedHours = Math.round(pace * 10) / 10

    const rag: RetainerBurnRow['rag'] =
      burnPct >= 85 ? 'red' : burnPct >= 70 ? 'amber' : 'green'

    return {
      projectId: p.id,
      clientName: p.client_name,
      feePerMonthCents: fee,
      hoursTarget: target,
      hoursUsed: Math.round(used * 10) / 10,
      burnPct,
      daysLeftInMonth: daysLeft,
      effectiveHourlyRateCents: target > 0 ? Math.round(fee / target) : 0,
      projectedHours,
      isOverrunRisk: projectedHours > target && daysLeft > 5,
      isUnderutilised: burnPct < 40 && daysLeft < 10,
      rag,
    }
  })
}

// Pulse defaults to in-progress retainers only (pace alerts are meaningless
// once a retainer is closed). The Retainers list passes includeCompleted so
// hours consumed stay visible after a retainer completes.
export function usePulseRetainerBurn(
  opts: { includeCompleted?: boolean } = {},
): RetainerBurnRow[] {
  const includeCompleted = opts.includeCompleted ?? false
  const { data } = useQuery({
    queryKey: ['pulseRetainerBurn', { includeCompleted }],
    queryFn: async () => {
      const { supabase } = await import('@/lib/supabase')
      const start = new Date()
      start.setDate(1)
      start.setHours(0, 0, 0, 0)

      const statuses: Array<'in_progress' | 'completed'> = includeCompleted
        ? ['in_progress', 'completed']
        : ['in_progress']
      const [{ data: projects }, { data: actuals }] = await Promise.all([
        supabase
          .from('projects')
          .select('id, engagement_type, retainer_hours_target, retainer_monthly_fee_cents, clients(name)')
          .eq('engagement_type', 'retainer')
          .in('status', statuses),
        supabase
          .from('project_actuals_current')
          .select('project_id, actual_hours')
          .gte('recorded_at', start.toISOString()),
      ])

      const mapped = (projects ?? []).map(p => ({
        ...p,
        client_name: (p.clients as { name: string } | null)?.name ?? 'Unknown',
      }))

      return computeRetainerBurn(mapped, actuals ?? [], new Date())
    },
    staleTime: 5 * 60 * 1000,
  })
  return data ?? []
}
