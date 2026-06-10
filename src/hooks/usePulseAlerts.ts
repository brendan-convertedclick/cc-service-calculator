import type { ArAgingBand, ClientHealthRow, PulseAlert, RetainerBurnRow } from '@/types/pulse'

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
const fmt = (cents: number) => ZAR.format(cents / 100)

export function computeAlerts(
  retainerRows: RetainerBurnRow[],
  arBands: ArAgingBand[],
  clientHealth: ClientHealthRow[],
  _reserved: unknown[],
): PulseAlert[] {
  const alerts: PulseAlert[] = []

  retainerRows
    .filter(r => r.isOverrunRisk || r.burnPct >= 85)
    .forEach(r => alerts.push({
      id: `retainer-${r.projectId}`,
      level: 'watch',
      message: `${r.clientName} retainer — ${r.burnPct}% of hours burned with ${r.daysLeftInMonth} days left`,
      linkTo: `/projects`,
    }))

  arBands
    .flatMap(b => b.invoices.filter(i => i.daysOverdue > 30))
    .forEach(i => alerts.push({
      id: `ar-${i.id}`,
      level: 'overdue',
      message: `${i.clientName} — Invoice ${i.invoiceNumber ?? fmt(i.amountCents)} overdue ${i.daysOverdue} days`,
      linkTo: `/reconciliation`,
    }))

  clientHealth
    .filter(c => c.daysSinceContact >= 21)
    .forEach(c => alerts.push({
      id: `client-${c.clientId}`,
      // 999 means "never contacted" — a bootstrapping gap, not an emergency.
      level: c.daysSinceContact >= 30 && c.daysSinceContact < 999 ? 'overdue' : 'flag_am',
      message: c.daysSinceContact >= 999
        ? `${c.clientName} — No contact recorded yet. Account manager should follow up.`
        : `${c.clientName} — No email or meeting in ${c.daysSinceContact} days. Account manager should follow up.`,
      linkTo: `/clients`,
    }))

  const order: Record<string, number> = { overdue: 0, watch: 1, flag_am: 2 }
  return alerts.sort((a, b) => order[a.level] - order[b.level])
}
