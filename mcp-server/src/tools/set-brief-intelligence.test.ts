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

  it('appends audit_trail_entry to existing trail', async () => {
    const existingTrail = [{ stage: 'classify', completed_at: '2026-01-01T00:00:00Z' }]
    const newEntry = { stage: 'extract-requirements', completed_at: '2026-01-01T00:01:00Z', confidence: 0.9 }

    // First call: SELECT for existing audit_trail
    // Second call: UPSERT with merged array
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // SELECT call
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { audit_trail: existingTrail },
                error: null,
              }),
            }),
          }),
        }
      }
      // UPSERT call
      return {
        upsert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          // Verify the merged array contains both entries
          expect(Array.isArray(payload.audit_trail)).toBe(true)
          expect((payload.audit_trail as unknown[]).length).toBe(2)
          expect((payload.audit_trail as Array<{stage: string}>)[0].stage).toBe('classify')
          expect((payload.audit_trail as Array<{stage: string}>)[1].stage).toBe('extract-requirements')
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'i', brief_id: 'b', am_status: 'pending' },
                error: null,
              }),
            }),
          }
        }),
      }
    })

    const result = await handler({ brief_id: 'b', audit_trail_entry: newEntry })
    expect(result.isError).toBeUndefined()
  })
})
