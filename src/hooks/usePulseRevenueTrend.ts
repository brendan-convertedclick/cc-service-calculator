import { useQuery } from '@tanstack/react-query'
import type { RevenueTrendRow } from '@/types/pulse'

interface ClientRow { id: string; name: string }
interface InvoiceRow { client_id: string | null; amount_cents: number; paid_at: string | null }

export function computeRevenueTrend(clients: ClientRow[], invoices: InvoiceRow[], today: Date): RevenueTrendRow[] {
  const months: { year: number; month: number; label: string }[] = []
  for (let i = 2; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    months.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: d.toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' }),
    })
  }

  return clients.map(c => {
    const clientInvoices = invoices.filter(i => i.client_id === c.id && i.paid_at)
    const monthTotals = months.map(m => {
      const total = clientInvoices
        .filter(i => {
          const d = new Date(i.paid_at!)
          return d.getFullYear() === m.year && d.getMonth() === m.month
        })
        .reduce((s, i) => s + i.amount_cents, 0)
      return { label: m.label, cents: total }
    })

    const thisMonth = monthTotals[2].cents
    const lastMonth = monthTotals[1].cents
    const momChangePct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null
    const trend: RevenueTrendRow['trend'] =
      momChangePct === null ? 'flat' : momChangePct >= 5 ? 'up' : momChangePct <= -5 ? 'down' : 'flat'

    return {
      clientId: c.id,
      clientName: c.name,
      months: monthTotals,
      momChangePct,
      thisMonthCents: thisMonth,
      trend,
    }
  }).sort((a, b) => b.thisMonthCents - a.thisMonthCents)
}

export function usePulseRevenueTrend(): RevenueTrendRow[] | null {
  const { data } = useQuery({
    queryKey: ['pulseRevenueTrend'],
    queryFn: async () => {
      const { supabase } = await import('@/lib/supabase')
      const since = new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString()
      const [{ data: clients }, { data: invoices }] = await Promise.all([
        supabase.from('clients').select('id, name').eq('status', 'active'),
        supabase.from('xero_invoices').select('client_id, amount_cents, paid_at').eq('status', 'PAID').gte('paid_at', since),
      ])
      if (!clients) return null
      return computeRevenueTrend(clients, invoices ?? [], new Date())
    },
    staleTime: 15 * 60 * 1000,
  })
  return data ?? null
}
