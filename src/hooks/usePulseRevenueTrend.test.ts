import { describe, it, expect } from 'vitest'
import { computeRevenueTrend } from './usePulseRevenueTrend'

const clients = [{ id: 'c1', name: 'Acme' }]
const invoices = [
  { client_id: 'c1', amount_cents: 1_000_000, paid_at: '2026-03-15T00:00:00Z' },
  { client_id: 'c1', amount_cents: 1_000_000, paid_at: '2026-04-15T00:00:00Z' },
  { client_id: 'c1', amount_cents: 1_200_000, paid_at: '2026-05-01T00:00:00Z' },
]
const TODAY = new Date('2026-05-09')

describe('computeRevenueTrend', () => {
  it('returns 3 months of data', () => {
    const rows = computeRevenueTrend(clients, invoices, TODAY)
    expect(rows[0].months).toHaveLength(3)
  })

  it('marks up trend when current month > previous by 5%+', () => {
    const rows = computeRevenueTrend(clients, invoices, TODAY)
    expect(rows[0].trend).toBe('up')
    expect(rows[0].momChangePct).toBe(20)
  })

  it('marks flat trend when change < 5%', () => {
    const flat = [
      { client_id: 'c1', amount_cents: 1_000_000, paid_at: '2026-04-15T00:00:00Z' },
      { client_id: 'c1', amount_cents: 1_000_000, paid_at: '2026-05-01T00:00:00Z' },
    ]
    const rows = computeRevenueTrend(clients, flat, TODAY)
    expect(rows[0].trend).toBe('flat')
  })
})
