import { describe, it, expect } from 'vitest'
import { computeAlerts } from './usePulseAlerts'
import type { RetainerBurnRow, ArAgingBand, ClientHealthRow } from '@/types/pulse'

const retainer: RetainerBurnRow = {
  projectId: 'p1', clientName: 'Acme', feePerMonthCents: 1_000_000,
  hoursTarget: 8, hoursUsed: 7.5, burnPct: 94, daysLeftInMonth: 9,
  effectiveHourlyRateCents: 125_000, projectedHours: 12,
  isOverrunRisk: true, isUnderutilised: false, rag: 'red', needsSetup: false,
}
const arBand: ArAgingBand = {
  band: '60+',
  totalCents: 500_000,
  invoices: [{ id: 'i1', invoiceNumber: 'INV-001', clientName: 'Beta', amountCents: 500_000, daysOverdue: 65 }],
}
const quietClient: ClientHealthRow = {
  clientId: 'c1', clientName: 'Gama', daysSinceContact: 25,
  lastTouchpointType: 'email', revenueTrend: 'flat', rag: 'amber',
}

describe('computeAlerts', () => {
  it('creates WATCH alert for retainer overrun risk', () => {
    const alerts = computeAlerts([retainer], [], [], [])
    expect(alerts.some(a => a.level === 'watch' && a.message.includes('Acme'))).toBe(true)
  })

  it('creates OVERDUE alert for 60+ day invoice', () => {
    const alerts = computeAlerts([], [arBand], [], [])
    expect(alerts.some(a => a.level === 'overdue' && a.message.includes('Beta'))).toBe(true)
  })

  it('creates FLAG_AM alert for client silent 21+ days', () => {
    const alerts = computeAlerts([], [], [quietClient], [])
    expect(alerts.some(a => a.level === 'flag_am' && a.message.includes('Gama'))).toBe(true)
  })

  it('uses "no contact recorded" copy for never-contacted clients', () => {
    const never = { ...quietClient, daysSinceContact: 999, lastTouchpointType: null }
    const alerts = computeAlerts([], [], [never], [])
    expect(alerts[0].message).toContain('No contact recorded yet')
    expect(alerts[0].message).not.toContain('999')
  })

  it('sorts overdue before watch before flag_am', () => {
    const alerts = computeAlerts([retainer], [arBand], [quietClient], [])
    expect(alerts[0].level).toBe('overdue')
    expect(alerts[1].level).toBe('watch')
    expect(alerts[2].level).toBe('flag_am')
  })
})
