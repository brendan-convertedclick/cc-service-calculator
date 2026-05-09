import { useQuery } from '@tanstack/react-query'
import type { WipFunnelData, WipFunnelStage } from '@/types/pulse'

interface Brief { id: string; am_status: string | null; quote_id: string | null }
interface Quote { id: string; status: string }
interface Project { id: string; status: string; scope_status: string; quote_id: string | null; completed_at: string | null }

export function computeWipFunnel(
  briefs: Brief[],
  quotes: Quote[],
  projects: Project[],
  allQuotes: Quote[],
): WipFunnelData {
  const quoteMap = new Map([...quotes, ...allQuotes].map(q => [q.id, q]))

  const received = briefs.filter(b => !b.am_status || b.am_status === 'pending')
  const scoping  = briefs.filter(b => b.am_status === 'reviewing')
  const quoted   = briefs.filter(b => {
    if (!b.quote_id) return false
    const q = quoteMap.get(b.quote_id)
    return q?.status === 'draft' || q?.status === 'sent'
  })
  const accepted = projects.filter(p => {
    if (!p.quote_id) return false
    const q = quoteMap.get(p.quote_id)
    return q?.status === 'accepted' && p.status !== 'completed'
  })
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const delivered = projects.filter(p => p.status === 'completed' && p.completed_at && p.completed_at >= thirtyDaysAgo)

  const stages: WipFunnelStage[] = [
    { stage: 'Received',  count: received.length,  itemIds: received.map(b => b.id) },
    { stage: 'Scoping',   count: scoping.length,   itemIds: scoping.map(b => b.id) },
    { stage: 'Quoted',    count: quoted.length,    itemIds: quoted.map(b => b.id) },
    { stage: 'Accepted',  count: accepted.length,  itemIds: accepted.map(p => p.id) },
    { stage: 'Delivered', count: delivered.length, itemIds: delivered.map(p => p.id) },
  ]

  const totalIn = received.length + scoping.length
  const conversionRate = totalIn > 0 ? Math.round((accepted.length / totalIn) * 100) : null

  return { stages, conversionRate, avgCycleDays: null }
}

export function usePulseWipFunnel(): WipFunnelData {
  const { data } = useQuery({
    queryKey: ['pulseWipFunnel'],
    queryFn: async () => {
      const { supabase } = await import('@/lib/supabase')
      const [{ data: briefs }, { data: quotes }, { data: projects }] = await Promise.all([
        supabase.from('briefs').select('id, am_status, quote_id').not('status', 'eq', 'archived'),
        supabase.from('quotes').select('id, status'),
        supabase.from('projects').select('id, status, scope_status, quote_id, completed_at').neq('status', 'archived'),
      ])
      return computeWipFunnel(briefs ?? [], quotes ?? [], projects ?? [], quotes ?? [])
    },
    staleTime: 5 * 60 * 1000,
  })
  return data ?? { stages: [], conversionRate: null, avgCycleDays: null }
}
