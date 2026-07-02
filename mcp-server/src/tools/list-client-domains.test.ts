import { describe, it, expect, vi, beforeEach } from 'vitest'

// brief_messages.select(...).eq('direction','inbound').not('from_email','is',null) → awaited
const mockMsgNot = vi.fn()
const mockMsgEq = vi.fn(() => ({ not: mockMsgNot }))
const mockMsgSelect = vi.fn(() => ({ eq: mockMsgEq }))
// clients.select('primary_domain').not('primary_domain','is',null) → awaited
const mockClientsNot = vi.fn()
const mockClientsSelect = vi.fn(() => ({ not: mockClientsNot }))
// client_domains.select('domain') → awaited
const mockCdSelect = vi.fn()

const mockFrom = vi.fn((table: string) => {
  if (table === 'brief_messages') return { select: mockMsgSelect }
  if (table === 'clients') return { select: mockClientsSelect }
  if (table === 'client_domains') return { select: mockCdSelect }
  return {}
})

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./list-client-domains.js')

describe('list-client-domains', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMsgNot.mockResolvedValue({ data: [], error: null })
    mockClientsNot.mockResolvedValue({ data: [], error: null })
    mockCdSelect.mockResolvedValue({ data: [], error: null })
  })

  it('aggregates + normalises domains from history, primary_domain and client_domains', async () => {
    mockMsgNot.mockResolvedValue({
      data: [
        { from_email: 'a@trellidor.co.za', brief: { client_id: 'c1' } },
        { from_email: 'x@orphan.com', brief: { client_id: null } }, // skipped — no client
      ],
      error: null,
    })
    mockClientsNot.mockResolvedValue({
      data: [{ primary_domain: 'https://trellidor.co.za/' }, { primary_domain: 'thekingscollege.co.za' }],
      error: null,
    })
    mockCdSelect.mockResolvedValue({
      data: [{ domain: 'stanton.global' }, { domain: '7twenty.tech' }],
      error: null,
    })

    const res = await handler({})
    expect(JSON.parse(res.content[0].text)).toEqual([
      '7twenty.tech',
      'stanton.global',
      'thekingscollege.co.za',
      'trellidor.co.za', // deduped: history + URL-form primary_domain collapse to one
    ])
  })

  it('returns error content when client_domains query fails', async () => {
    mockCdSelect.mockResolvedValue({ data: null, error: { message: 'db error' } })
    const res = await handler({})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('db error')
  })
})
