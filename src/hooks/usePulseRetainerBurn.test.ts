import { describe, it, expect } from 'vitest'
import { computeRetainerBurn } from './usePulseRetainerBurn'

const TODAY = new Date('2026-05-09T08:00:00Z')

const project = {
  id: 'p1',
  engagement_type: 'retainer',
  status: 'in_progress',
  retainer_hours_target: 8,
  retainer_monthly_fee_cents: 1_000_000,
  client_name: 'Acme',
}

describe('computeRetainerBurn', () => {
  it('returns burn % from hours used vs target', () => {
    const rows = computeRetainerBurn([project], [{ project_id: 'p1', actual_hours: 4 }], TODAY)
    expect(rows[0].hoursUsed).toBe(4)
    expect(rows[0].burnPct).toBe(50)
    expect(rows[0].rag).toBe('green')
  })

  it('sets rag amber when burn 70-84%', () => {
    const rows = computeRetainerBurn([project], [{ project_id: 'p1', actual_hours: 6 }], TODAY)
    expect(rows[0].rag).toBe('amber')
  })

  it('sets rag red when burn >= 85%', () => {
    const rows = computeRetainerBurn([project], [{ project_id: 'p1', actual_hours: 7 }], TODAY)
    expect(rows[0].rag).toBe('red')
  })

  it('flags overrun risk when pace implies overrun with >5 days left', () => {
    const fakeToday = new Date('2026-05-09T08:00:00Z')
    const rows = computeRetainerBurn([project], [{ project_id: 'p1', actual_hours: 7 }], fakeToday)
    expect(rows[0].isOverrunRisk).toBe(true)
  })

  it('excludes non-retainer projects', () => {
    const fixed = { ...project, engagement_type: 'fixed' }
    const rows = computeRetainerBurn([fixed], [{ project_id: 'p1', actual_hours: 4 }], TODAY)
    expect(rows).toHaveLength(0)
  })

  it('returns an in_progress retainer (Pulse burn query filters status=in_progress)', () => {
    const rows = computeRetainerBurn([project], [{ project_id: 'p1', actual_hours: 4 }], TODAY)
    expect(project.status).toBe('in_progress')
    expect(rows).toHaveLength(1)
    expect(rows[0].projectId).toBe('p1')
  })
})
