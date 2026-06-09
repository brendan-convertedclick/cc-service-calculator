import { describe, it, expect } from 'vitest'
import { computeWipFunnel } from './usePulseWipFunnel'

const briefs = [
  { id: 'b1', status: 'new', raw_subject: 'New landing page' },
  { id: 'b2', status: 'triaged', raw_subject: null },
  { id: 'b3', status: 'quoted', raw_subject: 'PPC audit' },
  { id: 'b4', status: 'spam', raw_subject: 'Buy followers' },
]
const quotes = [
  { id: 'q1', status: 'sent' },
]
const projects = [
  { id: 'proj1', name: 'Site rebuild', status: 'active', scope_status: 'on_track', quote_id: 'q2', completed_at: null },
]
const quotes2 = [{ id: 'q2', status: 'accepted' }]

describe('computeWipFunnel', () => {
  it('puts new briefs in Received', () => {
    const { stages } = computeWipFunnel(briefs, quotes, [], [])
    expect(stages.find(s => s.stage === 'Received')?.count).toBe(1)
  })

  it('puts triaged and scoped briefs in Scoping', () => {
    const { stages } = computeWipFunnel([...briefs, { id: 'b5', status: 'scoped', raw_subject: null }], quotes, [], [])
    expect(stages.find(s => s.stage === 'Scoping')?.count).toBe(2)
  })

  it('puts quoted briefs in Quoted', () => {
    const { stages } = computeWipFunnel(briefs, quotes, [], [])
    expect(stages.find(s => s.stage === 'Quoted')?.count).toBe(1)
  })

  it('ignores spam briefs', () => {
    const { stages } = computeWipFunnel(briefs, quotes, [], [])
    const total = stages.reduce((s, st) => s + st.count, 0)
    expect(total).toBe(3)
  })

  it('puts accepted-quote active projects in Accepted', () => {
    const { stages } = computeWipFunnel([], [], projects, quotes2)
    expect(stages.find(s => s.stage === 'Accepted')?.count).toBe(1)
  })

  it('computes conversion rate as accepted / (received + scoping)', () => {
    const { conversionRate } = computeWipFunnel(briefs, quotes2, projects, quotes2)
    expect(conversionRate).toBeGreaterThan(0)
  })

  it('carries brief subjects and project names per stage', () => {
    const { stages } = computeWipFunnel(briefs, quotes, projects, quotes2)
    expect(stages.find(s => s.stage === 'Received')?.itemNames).toEqual(['New landing page'])
    expect(stages.find(s => s.stage === 'Scoping')?.itemNames).toEqual(['Untitled brief'])
    expect(stages.find(s => s.stage === 'Quoted')?.itemNames).toEqual(['PPC audit'])
    expect(stages.find(s => s.stage === 'Accepted')?.itemNames).toEqual(['Site rebuild'])
  })
})
