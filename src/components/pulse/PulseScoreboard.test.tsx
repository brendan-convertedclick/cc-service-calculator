import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { PulseScoreboard } from './PulseScoreboard'
import type { ArAgingBand, ClientHealthRow, RetainerBurnRow, WipFunnelData } from '@/types/pulse'

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
// testing-library's default normalizer collapses NBSP to plain spaces in DOM text,
// but leaves the expected string raw — normalize here so the two compare equal.
const fmt = (cents: number) => ZAR.format(cents / 100).replace(/\s/g, ' ')

const bands: ArAgingBand[] = [
  { band: '0-30',  totalCents: 12_240_000, invoices: [{ id: 'i1', invoiceNumber: 'INV-1', clientName: 'A', amountCents: 12_240_000, daysOverdue: 10 }] },
  { band: '30-60', totalCents: 1_265_000,  invoices: [{ id: 'i2', invoiceNumber: 'INV-2', clientName: 'Pebble', amountCents: 1_265_000, daysOverdue: 35 }] },
  { band: '60+',   totalCents: 4_830_000,  invoices: [{ id: 'i3', invoiceNumber: 'INV-3', clientName: 'Eva-Last', amountCents: 4_830_000, daysOverdue: 42 }] },
]

const retainerBase: RetainerBurnRow = {
  projectId: 'p', clientName: 'X', feePerMonthCents: 1_000_000, hoursTarget: 10, hoursUsed: 5,
  burnPct: 50, daysLeftInMonth: 12, effectiveHourlyRateCents: 100_000, projectedHours: 10,
  isOverrunRisk: false, isUnderutilised: false, rag: 'green', needsSetup: false,
}
const retainers: RetainerBurnRow[] = [
  { ...retainerBase, projectId: 'p1', clientName: 'AeT', burnPct: 91 },
  { ...retainerBase, projectId: 'p2', clientName: 'BMC', burnPct: 88, isOverrunRisk: true },
  { ...retainerBase, projectId: 'p3', clientName: 'Calm', burnPct: 40 },
  { ...retainerBase, projectId: 'p4', clientName: 'New', needsSetup: true },
]

const health = (id: string, days: number): ClientHealthRow => ({
  clientId: id, clientName: id, daysSinceContact: days,
  lastTouchpointType: days >= 999 ? null : 'email', revenueTrend: 'flat', rag: 'green',
})
const clientHealth = [health('c1', 25), health('c2', 999), health('c3', 3), health('c4', 40)]

const wip: WipFunnelData = {
  stages: [
    { stage: 'Received', count: 28, itemIds: [], itemNames: [] },
    { stage: 'Accepted', count: 6, itemIds: [], itemNames: [] },
    { stage: 'Delivered', count: 1, itemIds: [], itemNames: [] },
  ],
  conversionRate: 18,
  avgCycleDays: 9,
}

function renderBoard(over: Partial<Parameters<typeof PulseScoreboard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PulseScoreboard arBands={bands} retainers={retainers} clientHealth={clientHealth} wip={wip} {...over} />
    </MemoryRouter>,
  )
}

describe('PulseScoreboard', () => {
  it('shows overdue AR with the 30d+ overdue subline and amount', () => {
    renderBoard()
    expect(screen.getByText(fmt(18_335_000))).toBeInTheDocument()
    expect(screen.getByText(`2 invoices 30d+ overdue · ${fmt(6_095_000)}`)).toBeInTheDocument()
  })

  it('shows a calm AR subline when nothing is 30d+ overdue', () => {
    renderBoard({ arBands: [bands[0]] })
    expect(screen.getByText(/nothing 30d\+ overdue/i)).toBeInTheDocument()
  })

  it('prompts to connect Xero when AR data is unavailable', () => {
    renderBoard({ arBands: null })
    expect(screen.getByText(/connect xero/i)).toBeInTheDocument()
  })

  it('counts running-hot retainers out of configured ones only', () => {
    renderBoard()
    expect(screen.getByText(/of 3 running hot/i)).toBeInTheDocument()
    expect(screen.getByText(/highest burn 91%/i)).toBeInTheDocument()
  })

  it('shows all-on-pace when no retainer is hot', () => {
    renderBoard({ retainers: [{ ...retainerBase, projectId: 'p9' }] })
    expect(screen.getByText(/all on pace/i)).toBeInTheDocument()
  })

  it('handles no configured retainers', () => {
    renderBoard({ retainers: [{ ...retainerBase, projectId: 'p9', needsSetup: true }] })
    expect(screen.getByText(/no retainers configured/i)).toBeInTheDocument()
  })

  it('counts follow-ups due and contacts this week', () => {
    renderBoard()
    expect(screen.getByText(/follow-ups due/i)).toBeInTheDocument()
    expect(screen.getByText(/1 contacted this week/i)).toBeInTheDocument()
  })

  it('shows accepted work in flight with conversion and cycle stats', () => {
    renderBoard()
    expect(screen.getByText('accepted in flight')).toBeInTheDocument()
    expect(screen.getByText(/18% brief→accepted · 9d avg cycle/i)).toBeInTheDocument()
  })

  it('omits conversion stats when not yet measurable', () => {
    renderBoard({ wip: { stages: [], conversionRate: null, avgCycleDays: null } })
    expect(screen.getByText(/no briefs in the pipeline yet/i)).toBeInTheDocument()
  })

  it('links each tile to its destination page', () => {
    renderBoard()
    expect(screen.getByRole('link', { name: /reconciliation/i })).toHaveAttribute('href', '/reconciliation')
    expect(screen.getByRole('link', { name: /retainers/i })).toHaveAttribute('href', '/retainers')
    expect(screen.getByRole('link', { name: /clients/i })).toHaveAttribute('href', '/clients')
    expect(screen.getByRole('link', { name: /briefs/i })).toHaveAttribute('href', '/briefs')
  })
})
