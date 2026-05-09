import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMaybeSingle = vi.fn()
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./check-duplicate-brief.js')

describe('check-duplicate-brief', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when thread not found', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await handler({ gmail_thread_id: 'thread-123' })
    expect(JSON.parse(result.content[0].text)).toBeNull()
  })

  it('returns brief_id when thread already exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: 'brief-abc' }, error: null })
    const result = await handler({ gmail_thread_id: 'thread-123' })
    expect(JSON.parse(result.content[0].text)).toEqual({ brief_id: 'brief-abc' })
    expect(mockEq).toHaveBeenCalledWith('gmail_thread_id', 'thread-123')
  })
})
