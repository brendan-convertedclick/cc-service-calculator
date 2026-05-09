import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ClientHealthSection } from './ClientHealthSection'
import type { ClientHealthRow } from '@/types/pulse'

const rows: ClientHealthRow[] = [
  { clientId: 'c1', clientName: 'Acme', daysSinceContact: 2,  lastTouchpointType: 'email',   revenueTrend: 'up',   rag: 'green' },
  { clientId: 'c2', clientName: 'Beta', daysSinceContact: 25, lastTouchpointType: 'meeting', revenueTrend: 'flat', rag: 'amber' },
  { clientId: 'c3', clientName: 'Zara', daysSinceContact: 35, lastTouchpointType: null,      revenueTrend: 'down', rag: 'red' },
]

describe('ClientHealthSection', () => {
  it('renders all client names', () => {
    render(<ClientHealthSection rows={rows} onLogTouchpoint={vi.fn()} />)
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Zara')).toBeInTheDocument()
  })

  it('shows days since contact', () => {
    render(<ClientHealthSection rows={rows} onLogTouchpoint={vi.fn()} />)
    expect(screen.getByText(/35 days/i)).toBeInTheDocument()
  })

  it('calls onLogTouchpoint when Log button clicked', () => {
    const spy = vi.fn()
    render(<ClientHealthSection rows={rows} onLogTouchpoint={spy} />)
    fireEvent.click(screen.getAllByRole('button', { name: /log/i })[0])
    expect(spy).toHaveBeenCalledWith('c1')
  })
})
