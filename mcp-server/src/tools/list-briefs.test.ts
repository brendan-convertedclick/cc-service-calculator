import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockResolve = vi.fn()
const mockLimit = vi.fn(() => mockResolve())
const mockOrder = vi.fn(() => ({ limit: mockLimit }))
const mockEq = vi.fn(() => ({ order: mockOrder, eq: vi.fn(() => ({ order: mockOrder })) }))
const mockSelect = vi.fn(() => ({ order: mockOrder, eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./list-briefs.js')

describe('list-briefs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns briefs list', async () => {
    const briefs = [{ id: 'b1', raw_subject: 'New website', sender_email: 'a@b.com', status: 'new', intent_type: 'new_brief', created_at: '2026-05-01', message_count: 1 }]
    mockResolve.mockResolvedValue({ data: briefs, error: null })
    const result = await handler({})
    expect(JSON.parse(result.content[0].text)).toEqual(briefs)
  })

  it('applies limit from input', async () => {
    mockResolve.mockResolvedValue({ data: [], error: null })
    await handler({ limit: 5 })
    expect(mockLimit).toHaveBeenCalledWith(5)
  })
})
