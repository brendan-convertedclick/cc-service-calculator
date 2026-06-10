import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { AlertsStrip } from './AlertsStrip'
import { MemoryRouter } from 'react-router-dom'
import type { PulseAlert } from '@/types/pulse'

const overdue1: PulseAlert = { id: 'o1', level: 'overdue', message: 'Eva-Last — Invoice INV-0231 overdue 42 days', linkTo: '/reconciliation' }
const overdue2: PulseAlert = { id: 'o2', level: 'overdue', message: 'Pebble — Invoice INV-0198 overdue 35 days', linkTo: '/reconciliation' }
const watch1: PulseAlert = { id: 'w1', level: 'watch', message: 'AeT retainer — 91% of hours burned with 12 days left', linkTo: '/projects' }
const routine = (n: number): PulseAlert => ({
  id: `f${n}`, level: 'flag_am',
  message: `Client ${n} — No contact recorded yet. Account manager should follow up.`,
  linkTo: '/clients',
})
const mix: PulseAlert[] = [overdue1, overdue2, watch1, ...Array.from({ length: 25 }, (_, i) => routine(i))]

function renderStrip(alerts: PulseAlert[]) {
  return render(<MemoryRouter><AlertsStrip alerts={alerts} /></MemoryRouter>)
}

describe('AlertsStrip (pulse meter)', () => {
  it('shows all-clear when no alerts', () => {
    renderStrip([])
    expect(screen.getByText(/all clear/i)).toBeInTheDocument()
  })

  it('shows total signal count', () => {
    renderStrip(mix)
    expect(screen.getByText(/28 signals/i)).toBeInTheDocument()
  })

  it('headlines the urgent count when overdue alerts exist', () => {
    renderStrip(mix)
    expect(screen.getByText(/2 urgent items need action/i)).toBeInTheDocument()
  })

  it('uses singular copy for one urgent item', () => {
    renderStrip([overdue1])
    expect(screen.getByText(/1 urgent item needs action/i)).toBeInTheDocument()
  })

  it('headlines calm copy when nothing is urgent', () => {
    renderStrip([watch1, routine(1)])
    expect(screen.getByText(/nothing urgent/i)).toBeInTheDocument()
  })

  it('shows a legend key with count per non-empty group', () => {
    renderStrip(mix)
    expect(screen.getByRole('button', { name: /2 overdue/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 to watch/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /25 follow-ups/i })).toBeInTheDocument()
  })

  it('omits legend keys for empty groups', () => {
    renderStrip([overdue1])
    expect(screen.queryByRole('button', { name: /to watch/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /follow-ups/i })).toBeNull()
  })

  it('keeps all detail panels closed by default', () => {
    renderStrip(mix)
    expect(screen.queryByText(/INV-0231/)).toBeNull()
    expect(screen.queryByText(/91% of hours/)).toBeNull()
  })

  it('opens a group panel when its legend key is clicked', async () => {
    const user = userEvent.setup()
    renderStrip(mix)
    await user.click(screen.getByRole('button', { name: /2 overdue/i }))
    expect(screen.getByText(/INV-0231/)).toBeInTheDocument()
    expect(screen.queryByText(/91% of hours/)).toBeNull()
  })

  it('switches panels when another legend key is clicked', async () => {
    const user = userEvent.setup()
    renderStrip(mix)
    await user.click(screen.getByRole('button', { name: /2 overdue/i }))
    await user.click(screen.getByRole('button', { name: /1 to watch/i }))
    expect(screen.queryByText(/INV-0231/)).toBeNull()
    expect(screen.getByText(/91% of hours/)).toBeInTheDocument()
  })

  it('closes the panel when its open legend key is clicked again', async () => {
    const user = userEvent.setup()
    renderStrip(mix)
    const key = screen.getByRole('button', { name: /2 overdue/i })
    await user.click(key)
    await user.click(key)
    expect(screen.queryByText(/INV-0231/)).toBeNull()
  })

  it('renders the follow-ups group as name chips capped with a "+N more" link', async () => {
    const user = userEvent.setup()
    renderStrip(mix)
    await user.click(screen.getByRole('button', { name: /25 follow-ups/i }))
    expect(screen.getByText('Client 0')).toBeInTheDocument()
    const more = screen.getByRole('link', { name: /\+17 more/i })
    expect(more).toHaveAttribute('href', '/clients')
  })

  it('links each open panel to its destination page', async () => {
    const user = userEvent.setup()
    renderStrip(mix)
    await user.click(screen.getByRole('button', { name: /2 overdue/i }))
    expect(screen.getByRole('link', { name: /open reconciliation/i })).toHaveAttribute('href', '/reconciliation')
  })
})
