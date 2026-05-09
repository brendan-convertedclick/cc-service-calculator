import { describe, it, expect } from 'vitest'
import { computeArAging } from './usePulseArAging'

const TODAY = new Date('2026-05-09')

const invoices = [
  { id: 'i1', invoice_number: 'INV-001', xero_contact_name: 'Acme', amount_cents: 1_000_000, due_date: '2026-04-20', status: 'AUTHORISED', paid_at: null }, // 19d overdue
  { id: 'i2', invoice_number: 'INV-002', xero_contact_name: 'Beta', amount_cents: 500_000,   due_date: '2026-04-01', status: 'AUTHORISED', paid_at: null }, // 38d overdue
  { id: 'i3', invoice_number: 'INV-003', xero_contact_name: 'Gama', amount_cents: 200_000,   due_date: '2026-05-01', status: 'AUTHORISED', paid_at: null }, // 8d overdue
  { id: 'i4', invoice_number: 'INV-004', xero_contact_name: 'Paid', amount_cents: 100_000,   due_date: '2026-04-01', status: 'PAID',       paid_at: '2026-04-01' }, // paid - excluded
]

describe('computeArAging', () => {
  it('puts 8d overdue invoice in 0-30 band', () => {
    const bands = computeArAging(invoices, TODAY)
    const b = bands.find(b => b.band === '0-30')!
    expect(b.invoices.map(i => i.id)).toContain('i3')
  })

  it('puts 19d overdue in 0-30 band', () => {
    const bands = computeArAging(invoices, TODAY)
    expect(bands.find(b => b.band === '0-30')!.invoices.map(i => i.id)).toContain('i1')
  })

  it('puts 38d overdue in 30-60 band', () => {
    const bands = computeArAging(invoices, TODAY)
    expect(bands.find(b => b.band === '30-60')!.invoices.map(i => i.id)).toContain('i2')
  })

  it('excludes paid invoices', () => {
    const bands = computeArAging(invoices, TODAY)
    const allIds = bands.flatMap(b => b.invoices.map(i => i.id))
    expect(allIds).not.toContain('i4')
  })

  it('totals cents per band', () => {
    const bands = computeArAging(invoices, TODAY)
    const band030 = bands.find(b => b.band === '0-30')!
    expect(band030.totalCents).toBe(1_200_000)
  })
})
