import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ArAgingSection } from './ArAgingSection'
import type { ArAgingBand } from '@/types/pulse'

const bands: ArAgingBand[] = [
  { band: '0-30',  totalCents: 2_800_000, invoices: [] },
  { band: '30-60', totalCents: 1_400_000, invoices: [] },
  { band: '60+',   totalCents: 800_000, invoices: [{ id: 'i1', invoiceNumber: 'INV-001', clientName: 'Acme', amountCents: 800_000, daysOverdue: 65 }] },
]

describe('ArAgingSection', () => {
  it('renders all 3 bands', () => {
    render(<MemoryRouter><ArAgingSection bands={bands} /></MemoryRouter>)
    expect(screen.getByText('0 – 30 days')).toBeInTheDocument()
    expect(screen.getByText('60+ days')).toBeInTheDocument()
  })

  it('shows not-connected state when bands is null', () => {
    render(<MemoryRouter><ArAgingSection bands={null} /></MemoryRouter>)
    expect(screen.getByText(/connect xero/i)).toBeInTheDocument()
  })
})
