import { useQuery } from '@tanstack/react-query'
import type { ArAgingBand } from '@/types/pulse'

interface Invoice {
  id: string
  invoice_number: string | null
  xero_contact_name: string | null
  amount_cents: number
  due_date: string | null
  status: string
  paid_at: string | null
}

export function computeArAging(invoices: Invoice[], today: Date): ArAgingBand[] {
  const unpaid = invoices.filter(
    i => i.due_date && !['PAID', 'VOIDED'].includes(i.status) && new Date(i.due_date) < today
  )

  const bucket = (inv: Invoice): ArAgingBand['band'] => {
    const days = Math.floor((today.getTime() - new Date(inv.due_date!).getTime()) / 86_400_000)
    if (days <= 30) return '0-30'
    if (days <= 60) return '30-60'
    return '60+'
  }

  const bands: ArAgingBand['band'][] = ['0-30', '30-60', '60+']
  return bands.map(band => {
    const matched = unpaid.filter(i => bucket(i) === band)
    return {
      band,
      totalCents: matched.reduce((s, i) => s + i.amount_cents, 0),
      invoices: matched.map(i => ({
        id: i.id,
        invoiceNumber: i.invoice_number,
        clientName: i.xero_contact_name ?? 'Unknown',
        amountCents: i.amount_cents,
        daysOverdue: Math.floor((today.getTime() - new Date(i.due_date!).getTime()) / 86_400_000),
      })),
    }
  })
}

export function usePulseArAging(): ArAgingBand[] | null {
  const { data } = useQuery({
    queryKey: ['pulseArAging'],
    queryFn: async () => {
      const { supabase } = await import('@/lib/supabase')
      const { data, error } = await supabase
        .from('xero_invoices')
        .select('id, invoice_number, xero_contact_name, amount_cents, due_date, status, paid_at')
        .not('status', 'in', '("PAID","VOIDED","DRAFT")')
      if (error) throw error
      return computeArAging(data ?? [], new Date())
    },
    staleTime: 10 * 60 * 1000,
  })
  return data ?? null
}
