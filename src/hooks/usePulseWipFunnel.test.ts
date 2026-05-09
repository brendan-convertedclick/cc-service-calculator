import { describe, it, expect } from 'vitest'
import { computeWipFunnel } from './usePulseWipFunnel'

const briefs = [
  { id: 'b1', am_status: null, quote_id: null },
  { id: 'b2', am_status: 'reviewing', quote_id: null },
  { id: 'b3', am_status: 'approved', quote_id: 'q1' },
]
const quotes = [
  { id: 'q1', status: 'sent' },
]
const projects = [
  { id: 'proj1', status: 'active', scope_status: 'on_track', quote_id: 'q2', completed_at: null },
]
const quotes2 = [{ id: 'q2', status: 'accepted' }]

describe('computeWipFunnel', () => {
  it('puts null am_status briefs in Received', () => {
    const { stages } = computeWipFunnel(briefs, quotes, [], [])
    expect(stages.find(s => s.stage === 'Received')?.count).toBe(1)
  })

  it('puts reviewing briefs in Scoping', () => {
    const { stages } = computeWipFunnel(briefs, quotes, [], [])
    expect(stages.find(s => s.stage === 'Scoping')?.count).toBe(1)
  })

  it('puts sent-quoted briefs in Quoted', () => {
    const { stages } = computeWipFunnel(briefs, quotes, [], [])
    expect(stages.find(s => s.stage === 'Quoted')?.count).toBe(1)
  })

  it('puts accepted-quote active projects in Accepted', () => {
    const { stages } = computeWipFunnel([], [], projects, quotes2)
    expect(stages.find(s => s.stage === 'Accepted')?.count).toBe(1)
  })

  it('computes conversion rate as accepted / (received + scoping)', () => {
    const { conversionRate } = computeWipFunnel(briefs, quotes2, projects, quotes2)
    expect(conversionRate).toBeGreaterThan(0)
  })
})
