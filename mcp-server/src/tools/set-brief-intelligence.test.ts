import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../supabase.js', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn(),
  },
}))

import { handler, schema } from './set-brief-intelligence.js'
import { supabase } from '../supabase.js'

const mockFrom = supabase.from as ReturnType<typeof vi.fn>

describe('set-brief-intelligence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts a brief_intelligence record and returns id + am_status', async () => {
    const fakeRow = {
      id: 'intel-uuid',
      brief_id: 'brief-uuid',
      am_status: 'pending',
    }
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: fakeRow, error: null }),
        }),
      }),
    })

    const result = await handler({ brief_id: 'brief-uuid', summary: 'Test summary' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.brief_id).toBe('brief-uuid')
    expect(parsed.am_status).toBe('pending')
    expect(result.isError).toBeUndefined()
  })

  it('returns error when upsert fails', async () => {
    mockFrom.mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'FK violation' } }),
        }),
      }),
    })

    const result = await handler({ brief_id: 'brief-uuid' })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.error).toBe('FK violation')
    expect(result.isError).toBe(true)
  })

  it('schema rejects missing brief_id', () => {
    expect(() => schema.parse({})).toThrow()
  })
})
