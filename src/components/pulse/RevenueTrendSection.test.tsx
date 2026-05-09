import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { RevenueTrendSection } from './RevenueTrendSection'

const rows = [
  {
    clientId: 'c1', clientName: 'Acme',
    months: [
      { label: 'Mar 26', cents: 1_000_000 },
      { label: 'Apr 26', cents: 1_000_000 },
      { label: 'May 26', cents: 1_200_000 },
    ],
    momChangePct: 20, thisMonthCents: 1_200_000, trend: 'up' as const,
  },
]

describe('RevenueTrendSection', () => {
  it('renders client name', () => {
    render(<MemoryRouter><RevenueTrendSection rows={rows} /></MemoryRouter>)
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })

  it('renders MoM change', () => {
    render(<MemoryRouter><RevenueTrendSection rows={rows} /></MemoryRouter>)
    expect(screen.getByText(/\+20%/)).toBeInTheDocument()
  })

  it('shows not-connected state when null', () => {
    render(<MemoryRouter><RevenueTrendSection rows={null} /></MemoryRouter>)
    expect(screen.getByText(/connect xero/i)).toBeInTheDocument()
  })
})
