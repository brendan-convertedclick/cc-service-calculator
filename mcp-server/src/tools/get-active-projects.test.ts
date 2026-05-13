import { describe, it, expect, vi, beforeEach } from 'vitest'

// projects.select(...).eq('client_id', ...).eq('status', 'in_progress')
const mockEq2 = vi.fn()
const mockEq1 = vi.fn(() => ({ eq: mockEq2 }))
const mockSelect = vi.fn(() => ({ eq: mockEq1 }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./get-active-projects.js')

describe('get-active-projects', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no active projects', async () => {
    mockEq2.mockResolvedValue({ data: [], error: null })
    const result = await handler({ client_id: 'client-1' })
    expect(JSON.parse(result.content[0].text)).toEqual([])
  })

  it('returns active projects for client', async () => {
    const projects = [{ id: 'proj-1', name: 'Website Redesign', project_code: 'WEB-001', status: 'in_progress', created_at: '2026-01-01' }]
    mockEq2.mockResolvedValue({ data: projects, error: null })
    const result = await handler({ client_id: 'client-1' })
    expect(JSON.parse(result.content[0].text)).toEqual(projects)
    expect(mockEq1).toHaveBeenCalledWith('client_id', 'client-1')
    expect(mockEq2).toHaveBeenCalledWith('status', 'in_progress')
  })
})
