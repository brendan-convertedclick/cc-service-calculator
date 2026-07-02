import { describe, it, expect, vi, beforeEach } from 'vitest'

// client_domains.select('client_id, domain')  → awaited
const mockCdSelect = vi.fn()
// clients.select('id, primary_domain').not('primary_domain', 'is', null)  → awaited
const mockClientNot = vi.fn()
const mockClientSelect = vi.fn(() => ({ not: mockClientNot }))
// client_sender_rules.select(...).eq('client_id', id)  → awaited
const mockRulesEq = vi.fn()
const mockRulesSelect = vi.fn(() => ({ eq: mockRulesEq }))

const mockFrom = vi.fn((table: string) => {
  if (table === 'client_domains') return { select: mockCdSelect }
  if (table === 'clients') return { select: mockClientSelect }
  if (table === 'client_sender_rules') return { select: mockRulesSelect }
  return {}
})

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./evaluate-sender.js')

describe('evaluate-sender', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCdSelect.mockResolvedValue({ data: [], error: null }) // no client_domains by default
  })

  it('returns unknown when no client owns the domain', async () => {
    mockClientNot.mockResolvedValue({ data: [{ id: 'c1', primary_domain: 'other.com' }], error: null })
    const res = await handler({ email: 'a@nowhere.com' })
    expect(JSON.parse(res.content[0].text)).toEqual({ decision: 'unknown' })
  })

  it('returns block when a block rule matches', async () => {
    mockClientNot.mockResolvedValue({ data: [{ id: 'c1', primary_domain: 'x.com' }], error: null })
    mockRulesEq.mockResolvedValue({
      data: [{ id: 'r1', pattern: 'greg@x.com', mode: 'block' }],
      error: null,
    })
    const res = await handler({ email: 'greg@x.com' })
    expect(JSON.parse(res.content[0].text)).toEqual({ decision: 'block', rule_id: 'r1', client_id: 'c1' })
  })

  it('returns pending when no rule matches but client owns domain', async () => {
    mockClientNot.mockResolvedValue({ data: [{ id: 'c1', primary_domain: 'x.com' }], error: null })
    mockRulesEq.mockResolvedValue({ data: [], error: null })
    const res = await handler({ email: 'someone@x.com' })
    expect(JSON.parse(res.content[0].text)).toEqual({ decision: 'pending', client_id: 'c1' })
  })

  it('resolves the client via client_domains (multi-domain group)', async () => {
    mockCdSelect.mockResolvedValue({ data: [{ client_id: 'cg', domain: 'stanton.global' }], error: null })
    mockRulesEq.mockResolvedValue({ data: [], error: null })
    const res = await handler({ email: 'trevor@stanton.global' })
    expect(JSON.parse(res.content[0].text)).toEqual({ decision: 'pending', client_id: 'cg' })
    // client_domains matched, so the primary_domain fallback should not be queried
    expect(mockClientSelect).not.toHaveBeenCalled()
  })

  it('matches when primary_domain is stored as a full URL (regression)', async () => {
    mockClientNot.mockResolvedValue({
      data: [{ id: 'c9', primary_domain: 'https://trellidor.co.za/' }],
      error: null,
    })
    mockRulesEq.mockResolvedValue({ data: [], error: null })
    const res = await handler({ email: 'jgovender@trellidor.co.za' })
    expect(JSON.parse(res.content[0].text)).toEqual({ decision: 'pending', client_id: 'c9' })
  })

  it('matches a subdomain sender against the client host', async () => {
    mockClientNot.mockResolvedValue({ data: [{ id: 'c1', primary_domain: 'trellidor.co.za' }], error: null })
    mockRulesEq.mockResolvedValue({ data: [], error: null })
    const res = await handler({ email: 'noreply@mail.trellidor.co.za' })
    expect(JSON.parse(res.content[0].text)).toEqual({ decision: 'pending', client_id: 'c1' })
  })

  it('returns error on supabase failure', async () => {
    mockCdSelect.mockResolvedValue({ data: null, error: { message: 'db error' } })
    const res = await handler({ email: 'a@x.com' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('db error')
  })
})
