import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PricingHealthSection } from './PricingHealthSection'

describe('PricingHealthSection', () => {
  it('renders scope creep rate', () => {
    render(<PricingHealthSection data={{ scopeCreepRate: 22, conversionRate: 78, byClient: [] }} />)
    expect(screen.getByText(/22%/)).toBeInTheDocument()
  })

  it('renders conversion rate', () => {
    render(<PricingHealthSection data={{ scopeCreepRate: 22, conversionRate: 78, byClient: [] }} />)
    expect(screen.getByText(/78%/)).toBeInTheDocument()
  })

  it('shows no-data state', () => {
    render(<PricingHealthSection data={null} />)
    expect(screen.getByText(/no completed projects/i)).toBeInTheDocument()
  })
})
