import { describe, it, expect } from 'vitest'
import { burnStatuses, computeRetainerBurn, filterBurnActuals } from './usePulseRetainerBurn'

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

  it('computes burn for a completed retainer (status filtering is the query layer’s job)', () => {
    const completed = { ...project, status: 'completed' }
    const rows = computeRetainerBurn([completed], [{ project_id: 'p1', actual_hours: 2 }], TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0].hoursUsed).toBe(2)
  })
})

describe('burnStatuses', () => {
  it('queries only in_progress by default (Pulse)', () => {
    expect(burnStatuses(false)).toEqual(['in_progress'])
  })

  it('adds completed when includeCompleted (Retainers list)', () => {
    expect(burnStatuses(true)).toEqual(['in_progress', 'completed'])
  })
})

describe('filterBurnActuals', () => {
  const monthStart = new Date('2026-06-01T00:00:00Z')
  const thisMonth = { project_id: 'p1', actual_hours: 1, recorded_at: '2026-06-09T10:00:00Z' }
  const lastMonth = { project_id: 'p1', actual_hours: 3, recorded_at: '2026-05-20T10:00:00Z' }

  it('applies the month window to in-progress retainers', () => {
    const kept = filterBurnActuals([thisMonth, lastMonth], new Set(), monthStart)
    expect(kept).toEqual([thisMonth])
  })

  it('keeps frozen pre-month snapshots for completed retainers (no misleading 0/N after rollover)', () => {
    const kept = filterBurnActuals([lastMonth], new Set(['p1']), monthStart)
    expect(kept).toEqual([lastMonth])
  })

  it('drops rows with no project or no recorded_at for in-progress projects', () => {
    const kept = filterBurnActuals(
      [
        { project_id: null, actual_hours: 1, recorded_at: '2026-06-09T10:00:00Z' },
        { project_id: 'p1', actual_hours: 1, recorded_at: null },
      ],
      new Set(),
      monthStart,
    )
    expect(kept).toEqual([])
  })
})
