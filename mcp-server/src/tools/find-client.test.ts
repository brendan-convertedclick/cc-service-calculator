import { describe, it, expect, vi, beforeEach } from 'vitest'

// First call: clients.select(...).ilike(...).maybeSingle()
const mockClientsMaybeSingle = vi.fn()
const mockClientsIlike = vi.fn(() => ({ maybeSingle: mockClientsMaybeSingle }))
const mockClientsSelect = vi.fn(() => ({ ilike: mockClientsIlike }))

// Fallback: brief_messages.select(...).ilike(...).eq(...).limit(1)
const mockMessagesLimit = vi.fn(() => Promise.resolve({ data: [], error: null }))
const mockMessagesEq = vi.fn(() => ({ limit: mockMessagesLimit }))
const mockMessagesIlike = vi.fn(() => ({ eq: mockMessagesEq }))
const mockMessagesSelect = vi.fn(() => ({ ilike: mockMessagesIlike }))

const mockFrom = vi.fn((table: string) => {
  if (table === 'clients') return { select: mockClientsSelect }
  if (table === 'brief_messages') return { select: mockMessagesSelect }
  return {}
})

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./find-client.js')

describe('find-client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMessagesLimit.mockResolvedValue({ data: [], error: null })
  })

  it('returns null when client not found and brief_messages fallback is empty', async () => {
    mockClientsMaybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await handler({ email_domain: 'unknown.co.za' })
    expect(JSON.parse(result.content[0].text)).toBeNull()
  })

  it('returns client when found by email_domain (primary path)', async () => {
    const client = { id: 'abc', name: 'Acme', wiki_path: 'wiki/clients/Acme', primary_domain: 'acme.co.za' }
    mockClientsMaybeSingle.mockResolvedValue({ data: client, error: null })
    const result = await handler({ email_domain: 'acme.co.za' })
    expect(JSON.parse(result.content[0].text)).toEqual(client)
    expect(mockClientsIlike).toHaveBeenCalledWith('primary_domain', '%acme.co.za%')
  })

  it('falls back to brief_messages history when primary_domain lookup misses', async () => {
    const client = { id: 'abc', name: 'Acme', wiki_path: 'wiki/clients/Acme', primary_domain: null }
    mockClientsMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockMessagesLimit.mockResolvedValue({
      data: [{ brief: { client } }],
      error: null,
    })
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
    mockClientsMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db error' } })
    const result = await handler({ email_domain: 'acme.co.za' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('db error')
  })
})
