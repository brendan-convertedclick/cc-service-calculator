import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn(() => Promise.resolve({
  data: [{ id: 'pc-1', seen_count: 3 }],
  error: null,
}))
vi.mock('../supabase.js', () => ({ supabase: { rpc: mockRpc } }))

const { handler } = await import('./record-pending-client.js')

describe('record-pending-client', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lowercases domain and calls queue_pending_client RPC', async () => {
    const res = await handler({
      domain: 'Acme.CO.za',
      sender: 'Greg@Acme.co.za',
      subject: 'Hello',
    })
    expect(mockRpc).toHaveBeenCalledWith('queue_pending_client', {
      p_domain: 'acme.co.za',
      p_sender: 'Greg@Acme.co.za',
      p_subject: 'Hello',
    })
    const out = JSON.parse(res.content[0].text)
    expect(out).toEqual({ id: 'pc-1', seen_count: 3 })
  })

  it('passes null subject when omitted', async () => {
    await handler({ domain: 'foo.com', sender: 'x@foo.com' })
    expect(mockRpc).toHaveBeenCalledWith('queue_pending_client', {
      p_domain: 'foo.com',
      p_sender: 'x@foo.com',
      p_subject: null,
    })
  })

  it('requires a non-empty domain', async () => {
    const res = await handler({ domain: '   ', sender: 'a@b.com' })
    expect(res.isError).toBe(true)
  })

  it('returns isError when RPC errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: null as never, error: { message: 'boom' } as never })
    const res = await handler({ domain: 'bar.com', sender: 'y@bar.com' })
    expect(res.isError).toBe(true)
    expect(JSON.parse(res.content[0].text)).toEqual({ error: 'boom' })
  })
})
