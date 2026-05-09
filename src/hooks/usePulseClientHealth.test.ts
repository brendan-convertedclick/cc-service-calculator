import { describe, it, expect } from 'vitest'
import { computeClientHealth } from './usePulseClientHealth'

const TODAY = new Date('2026-05-09')

const clients = [
  { id: 'c1', name: 'Acme' },
  { id: 'c2', name: 'Beta' },
  { id: 'c3', name: 'Gama' },
]
const briefs = [
  { client_id: 'c1', created_at: '2026-05-07T10:00:00Z' }, // 2d ago
  { client_id: 'c2', created_at: '2026-04-21T10:00:00Z' }, // 18d ago
]
const touchpoints = [
  { client_id: 'c3', type: 'meeting' as const, occurred_at: '2026-04-05T10:00:00Z' }, // 34d ago
]
const invoices: { client_id: string; paid_at: string }[] = []

describe('computeClientHealth', () => {
  it('green when last contact < 14 days', () => {
    const rows = computeClientHealth(clients, briefs, touchpoints, invoices, TODAY)
    expect(rows.find(r => r.clientId === 'c1')?.rag).toBe('green')
  })

  it('amber when last contact 14-30 days', () => {
    const rows = computeClientHealth(clients, briefs, touchpoints, invoices, TODAY)
    expect(rows.find(r => r.clientId === 'c2')?.rag).toBe('amber')
  })

  it('red when last contact > 30 days', () => {
    const rows = computeClientHealth(clients, briefs, touchpoints, invoices, TODAY)
    expect(rows.find(r => r.clientId === 'c3')?.rag).toBe('red')
  })

  it('sorts by days since contact descending', () => {
    const rows = computeClientHealth(clients, briefs, touchpoints, invoices, TODAY)
    expect(rows[0].clientId).toBe('c3')
  })
})
