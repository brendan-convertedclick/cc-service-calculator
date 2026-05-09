import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RetainerBurnSection } from './RetainerBurnSection'
import type { RetainerBurnRow } from '@/types/pulse'

const row: RetainerBurnRow = {
  projectId: 'p1', clientName: 'Acme',
  feePerMonthCents: 1_000_000, hoursTarget: 8, hoursUsed: 5.5,
  burnPct: 69, daysLeftInMonth: 18,
  effectiveHourlyRateCents: 125_000, projectedHours: 7,
  isOverrunRisk: false, isUnderutilised: false, rag: 'green',
}

describe('RetainerBurnSection', () => {
  it('renders client name', () => {
    render(<RetainerBurnSection rows={[row]} />)
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })

  it('renders burn percentage', () => {
    render(<RetainerBurnSection rows={[row]} />)
    expect(screen.getByText(/69%/)).toBeInTheDocument()
  })

  it('shows empty state when no retainers', () => {
    render(<RetainerBurnSection rows={[]} />)
    expect(screen.getByText(/no retainer clients/i)).toBeInTheDocument()
  })
})
