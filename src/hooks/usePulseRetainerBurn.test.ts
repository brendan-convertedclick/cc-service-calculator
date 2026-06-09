import { describe, it, expect } from 'vitest'
import { computeRetainerBurn, currentMonthKey, monthRange, referenceDateForMonth } from './usePulseRetainerBurn'

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

  it('surfaces retainers with no hours target as needsSetup rows', () => {
    const unconfigured = { ...project, id: 'p2', retainer_hours_target: null, retainer_monthly_fee_cents: null }
    const rows = computeRetainerBurn([unconfigured], [{ project_id: 'p2', actual_hours: 3 }], TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0].needsSetup).toBe(true)
    expect(rows[0].hoursUsed).toBe(3)
    expect(rows[0].isOverrunRisk).toBe(false)
  })

  it('sorts configured retainers before needsSetup rows', () => {
    const unconfigured = { ...project, id: 'p2', retainer_hours_target: null }
    const rows = computeRetainerBurn([unconfigured, project], [], TODAY)
    expect(rows.map(r => r.projectId)).toEqual(['p1', 'p2'])
  })

  it('returns an in_progress retainer (Pulse burn query filters status=in_progress)', () => {
    const rows = computeRetainerBurn([project], [{ project_id: 'p1', actual_hours: 4 }], TODAY)
    expect(project.status).toBe('in_progress')
    expect(rows).toHaveLength(1)
    expect(rows[0].projectId).toBe('p1')
  })
})

describe('month helpers', () => {
  it('currentMonthKey formats as YYYY-MM', () => {
    expect(currentMonthKey(new Date('2026-06-09T08:00:00'))).toBe('2026-06')
    expect(currentMonthKey(new Date('2026-01-31T23:00:00'))).toBe('2026-01')
  })

  it('monthRange spans first of month to first of next month', () => {
    const { start, end } = monthRange('2026-06')
    expect(start).toEqual(new Date(2026, 5, 1))
    expect(end).toEqual(new Date(2026, 6, 1))
  })

  it('referenceDateForMonth returns now for the current month', () => {
    const now = new Date(2026, 5, 9, 8, 0)
    expect(referenceDateForMonth('2026-06', now)).toEqual(now)
  })

  it('referenceDateForMonth returns last day for a past month', () => {
    const now = new Date(2026, 5, 9)
    expect(referenceDateForMonth('2026-04', now)).toEqual(new Date(2026, 3, 30))
  })

  it('referenceDateForMonth returns first day for a future month', () => {
    const now = new Date(2026, 5, 9)
    expect(referenceDateForMonth('2026-08', now)).toEqual(new Date(2026, 7, 1))
  })

  it('past month burn has 0 days left and projection equals usage', () => {
    const ref = referenceDateForMonth('2026-04', new Date(2026, 5, 9))
    const rows = computeRetainerBurn([project], [{ project_id: 'p1', actual_hours: 6 }], ref)
    expect(rows[0].daysLeftInMonth).toBe(0)
    expect(rows[0].projectedHours).toBe(6)
    expect(rows[0].isOverrunRisk).toBe(false)
  })
})
