import { describe, it, expect, vi, beforeEach } from 'vitest'

// client_domains.select('domain, client:clients!inner(...)')  → awaited
const mockCdSelect = vi.fn()
// Domain path: clients.select(...).not('primary_domain', 'is', null)  → awaited
// Name path:   clients.select(...).ilike('name', '%..%').maybeSingle()
const mockClientsNot = vi.fn()
const mockClientsMaybeSingle = vi.fn()
const mockClientsIlike = vi.fn(() => ({ maybeSingle: mockClientsMaybeSingle }))
const mockClientsSelect = vi.fn(() => ({ not: mockClientsNot, ilike: mockClientsIlike }))

// Fallback: brief_messages.select(...).ilike(...).eq(...).limit(1)
const mockMessagesLimit = vi.fn(() => Promise.resolve({ data: [], error: null }))
const mockMessagesEq = vi.fn(() => ({ limit: mockMessagesLimit }))
const mockMessagesIlike = vi.fn(() => ({ eq: mockMessagesEq }))
const mockMessagesSelect = vi.fn(() => ({ ilike: mockMessagesIlike }))

const mockFrom = vi.fn((table: string) => {
  if (table === 'client_domains') return { select: mockCdSelect }
  if (table === 'clients') return { select: mockClientsSelect }
  if (table === 'brief_messages') return { select: mockMessagesSelect }
  return {}
})

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./find-client.js')

describe('find-client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCdSelect.mockResolvedValue({ data: [], error: null }) // no client_domains by default
    mockMessagesLimit.mockResolvedValue({ data: [], error: null })
  })

  it('returns null when client not found and brief_messages fallback is empty', async () => {
    mockClientsNot.mockResolvedValue({ data: [], error: null })
    const result = await handler({ email_domain: 'unknown.co.za' })
    expect(JSON.parse(result.content[0].text)).toBeNull()
  })

  it('resolves via client_domains (multi-domain group)', async () => {
    const client = { id: 'pg', name: 'Pimms', wiki_path: 'wiki/clients/pimms', primary_domain: null }
    mockCdSelect.mockResolvedValue({ data: [{ domain: 'stanton.global', client }], error: null })
    const result = await handler({ email_domain: 'stanton.global' })
    expect(JSON.parse(result.content[0].text)).toEqual(client)
    // matched in client_domains → primary_domain fallback not queried
    expect(mockClientsSelect).not.toHaveBeenCalled()
  })

  it('returns client when found by email_domain (primary_domain path)', async () => {
    const client = { id: 'abc', name: 'Acme', wiki_path: 'wiki/clients/Acme', primary_domain: 'acme.co.za' }
    mockClientsNot.mockResolvedValue({ data: [client], error: null })
    const result = await handler({ email_domain: 'acme.co.za' })
    expect(JSON.parse(result.content[0].text)).toEqual(client)
    expect(mockClientsNot).toHaveBeenCalledWith('primary_domain', 'is', null)
  })

  it('matches when primary_domain is stored as a full URL (regression)', async () => {
    const client = { id: 'abc', name: 'Trellidor', wiki_path: 'wiki/clients/trellidor', primary_domain: 'https://trellidor.co.za/' }
    mockClientsNot.mockResolvedValue({ data: [client], error: null })
    const result = await handler({ email_domain: 'trellidor.co.za' })
    expect(JSON.parse(result.content[0].text)).toEqual(client)
  })

  it('falls back to brief_messages history when no primary_domain matches', async () => {
    const client = { id: 'abc', name: 'Acme', wiki_path: 'wiki/clients/Acme', primary_domain: null }
    mockClientsNot.mockResolvedValue({ data: [], error: null })
    mockMessagesLimit.mockResolvedValue({ data: [{ brief: { client } }], error: null })
    const result = await handler({ email_domain: 'acme.co.za' })
    expect(JSON.parse(result.content[0].text)).toEqual(client)
    expect(mockMessagesIlike).toHaveBeenCalledWith('from_email', '%@acme.co.za')
    expect(mockMessagesEq).toHaveBeenCalledWith('direction', 'inbound')
  })

  it('searches by name when email_domain is absent', async () => {
    mockClientsMaybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await handler({ name: 'Acme' })
    expect(JSON.parse(result.content[0].text)).toBeNull()
    expect(mockClientsIlike).toHaveBeenCalledWith('name', '%Acme%')
  })

  it('returns error content on supabase error', async () => {
    mockCdSelect.mockResolvedValue({ data: null, error: { message: 'db error' } })
    const result = await handler({ email_domain: 'acme.co.za' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('db error')
  })
})
