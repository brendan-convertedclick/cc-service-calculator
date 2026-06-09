import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { RetainerBurnSection } from './RetainerBurnSection'
import type { RetainerBurnRow } from '@/types/pulse'

const row: RetainerBurnRow = {
  projectId: 'p1', clientName: 'Acme',
  feePerMonthCents: 1_000_000, hoursTarget: 8, hoursUsed: 5.5,
  burnPct: 69, daysLeftInMonth: 18,
  effectiveHourlyRateCents: 125_000, projectedHours: 7,
  isOverrunRisk: false, isUnderutilised: false, rag: 'green', needsSetup: false,
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

  it('renders heading for the selected month', () => {
    render(<RetainerBurnSection rows={[row]} month="2026-04" onMonthChange={() => {}} />)
    expect(screen.getByText(/Retainer Burn — April 2026/)).toBeInTheDocument()
  })

  it('fires onMonthChange when a new month is picked', () => {
    const onMonthChange = vi.fn()
    render(<RetainerBurnSection rows={[row]} month="2026-06" onMonthChange={onMonthChange} />)
    fireEvent.change(screen.getByLabelText('Select month'), { target: { value: '2026-05' } })
    expect(onMonthChange).toHaveBeenCalledWith('2026-05')
  })

  it('hides the month picker when no handler is provided', () => {
    render(<RetainerBurnSection rows={[row]} />)
    expect(screen.queryByLabelText('Select month')).not.toBeInTheDocument()
  })

  it('renders a setup hint for retainers with no hours target', () => {
    const unconfigured: RetainerBurnRow = {
      ...row, projectId: 'p2', clientName: 'Appliance Man',
      hoursTarget: 0, hoursUsed: 0, burnPct: 0, needsSetup: true,
    }
    render(
      <MemoryRouter>
        <RetainerBurnSection rows={[unconfigured]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Appliance Man')).toBeInTheDocument()
    expect(screen.getByText(/no hours target set/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /set target/i })).toHaveAttribute('href', '/retainers')
  })
})
