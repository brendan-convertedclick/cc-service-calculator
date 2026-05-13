import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn(() => Promise.resolve({
  data: [{ id: 'pc-1', seen_count: 1 }],
  error: null,
}))
const mockUpsert = vi.fn(() => ({ select: mockSelect }))
const mockFrom = vi.fn(() => ({ upsert: mockUpsert }))
vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./record-pending-client.js')

describe('record-pending-client', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lowercases domain and upserts on domain conflict, clearing dismissed_at', async () => {
    const res = await handler({
      domain: 'Acme.CO.za',
      sender: 'Greg@Acme.co.za',
      subject: 'Hello',
    })
    expect(mockFrom).toHaveBeenCalledWith('pending_clients')
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    const [payload, opts] = mockUpsert.mock.calls[0]
    expect(payload.domain).toBe('acme.co.za')
    expect(payload.sample_sender).toBe('Greg@Acme.co.za')
    expect(payload.sample_subject).toBe('Hello')
    expect(payload.dismissed_at).toBeNull()
    expect(opts).toEqual({ onConflict: 'domain', ignoreDuplicates: false })

    const out = JSON.parse(res.content[0].text)
    expect(out).toEqual({ id: 'pc-1', seen_count: 1 })
  })

  it('requires a non-empty domain', async () => {
    const res = await handler({ domain: '   ', sender: 'a@b.com' })
    expect(res.isError).toBe(true)
  })
})
