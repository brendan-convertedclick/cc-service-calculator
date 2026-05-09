import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../supabase.js', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  },
}))

import { handler, schema } from './get-brief-intelligence.js'
import { supabase } from '../supabase.js'

const mockFrom = supabase.from as ReturnType<typeof vi.fn>

describe('get-brief-intelligence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the intelligence record for a brief', async () => {
    const fakeRow = { id: 'intel-uuid', brief_id: 'brief-uuid', am_status: 'pending', summary: 'Test' }
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: fakeRow, error: null }),
        }),
      }),
    })

    const result = await handler({ brief_id: 'brief-uuid' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.am_status).toBe('pending')
    expect(parsed.summary).toBe('Test')
  })

  it('returns null when no record exists', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })

    const result = await handler({ brief_id: 'brief-uuid' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toBeNull()
  })

  it('returns error on DB failure', async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB down' } }),
        }),
      }),
    })

    const result = await handler({ brief_id: 'brief-uuid' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error).toBe('DB down')
    expect(result.isError).toBe(true)
  })
})
