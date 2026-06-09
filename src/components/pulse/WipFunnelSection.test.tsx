import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { WipFunnelSection } from './WipFunnelSection'
import type { WipFunnelData } from '@/types/pulse'

const data: WipFunnelData = {
  stages: [
    { stage: 'Received',  count: 7, itemIds: [], itemNames: [] },
    { stage: 'Scoping',   count: 4, itemIds: [], itemNames: [] },
    { stage: 'Quoted',    count: 3, itemIds: [], itemNames: [] },
    { stage: 'Accepted',  count: 2, itemIds: ['p1', 'p2'], itemNames: ['Site rebuild', 'SEO sprint'] },
    { stage: 'Delivered', count: 5, itemIds: [], itemNames: [] },
  ],
  conversionRate: 78,
  avgCycleDays: 4.2,
}

describe('WipFunnelSection', () => {
  it('renders all 5 stage labels', () => {
    render(<WipFunnelSection data={data} />)
    expect(screen.getByText('Received')).toBeInTheDocument()
    expect(screen.getByText('Delivered')).toBeInTheDocument()
  })

  it('renders conversion rate', () => {
    render(<WipFunnelSection data={data} />)
    expect(screen.getByText(/78%/)).toBeInTheDocument()
  })

  it('shows item names in a tooltip on hover', async () => {
    const user = userEvent.setup()
    render(<WipFunnelSection data={data} />)
    await user.hover(screen.getByText('2'))
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Site rebuild')
    expect(tooltip).toHaveTextContent('SEO sprint')
  })
})
