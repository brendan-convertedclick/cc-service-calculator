import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ClientHealthRow } from '@/types/pulse'

interface ClientRow { id: string; name: string }
interface BriefRow { client_id: string | null; created_at: string }
interface TouchpointRow { client_id: string; type: 'meeting' | 'call' | 'email'; occurred_at: string }
interface InvoiceRow { client_id: string | null; paid_at: string | null }

export function computeClientHealth(
  clients: ClientRow[],
  briefs: BriefRow[],
  touchpoints: TouchpointRow[],
  invoices: InvoiceRow[],
  today: Date,
): ClientHealthRow[] {
  return clients
    .map(c => {
      const dates: Date[] = []
      const typeMap = new Map<number, ClientHealthRow['lastTouchpointType']>()

      briefs.filter(b => b.client_id === c.id).forEach(b => {
        const d = new Date(b.created_at)
        dates.push(d)
        typeMap.set(d.getTime(), 'email')
      })
      touchpoints.filter(t => t.client_id === c.id).forEach(t => {
        const d = new Date(t.occurred_at)
        dates.push(d)
        typeMap.set(d.getTime(), t.type)
      })
      invoices.filter(i => i.client_id === c.id && i.paid_at).forEach(i => {
        const d = new Date(i.paid_at!)
        dates.push(d)
        typeMap.set(d.getTime(), 'invoice')
      })

      dates.sort((a, b) => b.getTime() - a.getTime())
      const latest = dates[0]
      const daysSince = latest
        ? Math.floor((today.getTime() - latest.getTime()) / 86_400_000)
        : 999

      const rag: ClientHealthRow['rag'] = daysSince > 30 ? 'red' : daysSince > 14 ? 'amber' : 'green'

      return {
        clientId: c.id,
        clientName: c.name,
        daysSinceContact: daysSince,
        lastTouchpointType: latest ? (typeMap.get(latest.getTime()) ?? null) : null,
        revenueTrend: 'flat' as const,
        rag,
      }
    })
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact)
}

export function usePulseClientHealth(): ClientHealthRow[] {
  const { data } = useQuery({
    queryKey: ['pulseClientHealth'],
    queryFn: async () => {
      const { supabase } = await import('@/lib/supabase')
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString()
      const [{ data: clients }, { data: briefs }, { data: touchpoints }, { data: invoices }] =
        await Promise.all([
          supabase.from('clients').select('id, name').is('archived_at', null),
          supabase.from('briefs').select('client_id, created_at').gte('created_at', ninetyDaysAgo),
          supabase.from('client_touchpoints').select('client_id, type, occurred_at').gte('occurred_at', ninetyDaysAgo),
          supabase.from('xero_invoices').select('client_id, paid_at').not('paid_at', 'is', null).gte('paid_at', ninetyDaysAgo),
        ])
      return computeClientHealth(clients ?? [], briefs ?? [], touchpoints ?? [], invoices ?? [], new Date())
    },
    staleTime: 5 * 60 * 1000,
  })
  return data ?? []
}

export function useLogTouchpoint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      clientId: string
      type: 'meeting' | 'call' | 'email'
      notes?: string
      occurredAt: string
    }) => {
      const { supabase } = await import('@/lib/supabase')
      const { error } = await supabase.from('client_touchpoints').insert({
        client_id: payload.clientId,
        type: payload.type,
        notes: payload.notes ?? null,
        occurred_at: payload.occurredAt,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pulseClientHealth'] }),
  })
}
