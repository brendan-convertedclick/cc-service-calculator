import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMaybeSingle = vi.fn()
const mockNotIn = vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn(() => ({ maybeSingle: mockMaybeSingle })) })) }))
const mockEqIntent = vi.fn(() => ({ not: vi.fn(() => mockNotIn()) }))
const mockEqClient = vi.fn(() => ({ eq: mockEqIntent }))
const mockSelect = vi.fn(() => ({ eq: mockEqClient }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./get-active-retainer.js')

describe('get-active-retainer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when no active retainer', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await handler({ client_id: 'client-1' })
    expect(JSON.parse(result.content[0].text)).toBeNull()
  })

  it('returns retainer summary when found', async () => {
    const row = {
      id: 'brief-ret',
      raw_subject: 'Monthly Retainer',
      scopes: { enhanced_prose: 'Monthly support retainer covering 20hrs of dev work.' },
    }
    mockMaybeSingle.mockResolvedValue({ data: row, error: null })
    const result = await handler({ client_id: 'client-1' })
    expect(JSON.parse(result.content[0].text)).toEqual({
      brief_id: 'brief-ret',
      subject: 'Monthly Retainer',
      scope_summary: 'Monthly support retainer covering 20hrs of dev work.',
    })
  })
})
