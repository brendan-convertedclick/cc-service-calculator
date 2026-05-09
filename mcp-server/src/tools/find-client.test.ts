import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMaybeSingle = vi.fn()
const mockIlike = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ ilike: mockIlike }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./find-client.js')

describe('find-client', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when client not found', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await handler({ email_domain: 'unknown.co.za' })
    expect(JSON.parse(result.content[0].text)).toBeNull()
  })

  it('returns client when found by email_domain', async () => {
    const client = { id: 'abc', name: 'Acme', wiki_path: 'wiki/clients/Acme', primary_domain: 'acme.co.za' }
    mockMaybeSingle.mockResolvedValue({ data: client, error: null })
    const result = await handler({ email_domain: 'acme.co.za' })
    expect(JSON.parse(result.content[0].text)).toEqual(client)
    expect(mockIlike).toHaveBeenCalledWith('primary_domain', '%acme.co.za%')
  })

  it('searches by name when email_domain is absent', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    await handler({ name: 'Acme' })
    expect(mockIlike).toHaveBeenCalledWith('name', '%Acme%')
  })

  it('returns error content on supabase error', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db error' } })
    const result = await handler({ email_domain: 'acme.co.za' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('db error')
  })
})
