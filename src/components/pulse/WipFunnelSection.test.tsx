import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { WipFunnelSection } from './WipFunnelSection'
import type { WipFunnelData } from '@/types/pulse'

const data: WipFunnelData = {
  stages: [
    { stage: 'Received',  count: 7, itemIds: [] },
    { stage: 'Scoping',   count: 4, itemIds: [] },
    { stage: 'Quoted',    count: 3, itemIds: [] },
    { stage: 'Accepted',  count: 2, itemIds: [] },
    { stage: 'Delivered', count: 5, itemIds: [] },
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
})
