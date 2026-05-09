import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { AlertsStrip } from './AlertsStrip'
import { MemoryRouter } from 'react-router-dom'

const alerts = [
  { id: 'a1', level: 'overdue' as const, message: 'Acme overdue 34 days', linkTo: '/reconciliation' },
]

describe('AlertsStrip', () => {
  it('shows all-clear when no alerts', () => {
    render(<MemoryRouter><AlertsStrip alerts={[]} /></MemoryRouter>)
    expect(screen.getByText(/all clear/i)).toBeInTheDocument()
  })

  it('shows alert count when alerts present', () => {
    render(<MemoryRouter><AlertsStrip alerts={alerts} /></MemoryRouter>)
    expect(screen.getByText(/1 item/i)).toBeInTheDocument()
  })

  it('renders alert message', () => {
    render(<MemoryRouter><AlertsStrip alerts={alerts} /></MemoryRouter>)
    expect(screen.getByText(/Acme overdue 34 days/i)).toBeInTheDocument()
  })
})
