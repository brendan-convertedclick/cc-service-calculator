import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockClientMaybeSingle = vi.fn()
const mockClientIlike = vi.fn(() => ({ maybeSingle: mockClientMaybeSingle }))
const mockClientSelect = vi.fn(() => ({ ilike: mockClientIlike }))

const mockRulesEq = vi.fn()
const mockRulesSelect = vi.fn(() => ({ eq: mockRulesEq }))

const mockFrom = vi.fn((table: string) => {
  if (table === 'clients') return { select: mockClientSelect }
  if (table === 'client_sender_rules') return { select: mockRulesSelect }
  return {}
})

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./evaluate-sender.js')

describe('evaluate-sender', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns unknown when no client owns the domain', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: null, error: null })
    const res = await handler({ email: 'a@nowhere.com' })
    expect(JSON.parse(res.content[0].text)).toEqual({ decision: 'unknown' })
  })

  it('returns block when a block rule matches', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: { id: 'c1' }, error: null })
    mockRulesEq.mockResolvedValue({
      data: [{ id: 'r1', pattern: 'greg@x.com', mode: 'block' }],
      error: null,
    })
    const res = await handler({ email: 'greg@x.com' })
    expect(JSON.parse(res.content[0].text)).toEqual({ decision: 'block', rule_id: 'r1', client_id: 'c1' })
  })

  it('returns pending when no rule matches but client owns domain', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: { id: 'c1' }, error: null })
    mockRulesEq.mockResolvedValue({ data: [], error: null })
    const res = await handler({ email: 'someone@x.com' })
    expect(JSON.parse(res.content[0].text)).toEqual({ decision: 'pending', client_id: 'c1' })
  })

  it('returns error on supabase failure', async () => {
    mockClientMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db error' } })
    const res = await handler({ email: 'a@x.com' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('db error')
  })
})
