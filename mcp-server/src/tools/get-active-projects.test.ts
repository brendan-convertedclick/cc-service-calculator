import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockData: unknown[] = []
const mockIn = vi.fn(() => Promise.resolve({ data: mockData, error: null }))
const mockEq = vi.fn(() => ({ in: mockIn }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./get-active-projects.js')

describe('get-active-projects', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty array when no active projects', async () => {
    mockIn.mockResolvedValue({ data: [], error: null })
    const result = await handler({ client_id: 'client-1' })
    expect(JSON.parse(result.content[0].text)).toEqual([])
  })

  it('returns active projects for client', async () => {
    const projects = [{ id: 'proj-1', name: 'Website Redesign', project_code: 'WEB-001', status: 'active', created_at: '2026-01-01' }]
    mockIn.mockResolvedValue({ data: projects, error: null })
    const result = await handler({ client_id: 'client-1' })
    expect(JSON.parse(result.content[0].text)).toEqual(projects)
    expect(mockEq).toHaveBeenCalledWith('client_id', 'client-1')
    expect(mockIn).toHaveBeenCalledWith('status', ['active', 'in_progress'])
  })
})
