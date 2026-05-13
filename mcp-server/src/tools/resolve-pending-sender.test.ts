import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPendingMaybeSingle = vi.fn()
const mockPendingEq = vi.fn(() => ({ maybeSingle: mockPendingMaybeSingle }))
const mockPendingSelect = vi.fn(() => ({ eq: mockPendingEq }))

const mockRulesUpsert = vi.fn(() => Promise.resolve({ error: null }))

const mockPendingDeleteEq = vi.fn(() => Promise.resolve({ error: null }))
const mockPendingDelete = vi.fn(() => ({ eq: mockPendingDeleteEq }))

const mockFrom = vi.fn((table: string) => {
  if (table === 'pending_senders') {
    // First call (select) vs second call (delete) — distinguish by method use.
    return { select: mockPendingSelect, delete: mockPendingDelete }
  }
  if (table === 'client_sender_rules') return { upsert: mockRulesUpsert }
  return {}
})
vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./resolve-pending-sender.js')

describe('resolve-pending-sender', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes a rule then deletes the pending row', async () => {
    mockPendingMaybeSingle.mockResolvedValue({ data: { client_id: 'c1', email: 'Greg@X.com' }, error: null })
    const res = await handler({ pending_id: 'p1', action: 'block' })
    expect(JSON.parse(res.content[0].text)).toEqual({ resolved: true, client_id: 'c1', email: 'Greg@X.com', mode: 'block' })
    expect(mockRulesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: 'greg@x.com', mode: 'block', client_id: 'c1' }),
      { onConflict: 'client_id,pattern' },
    )
    expect(mockPendingDelete).toHaveBeenCalled()
  })

  it('errors when pending row not found', async () => {
    mockPendingMaybeSingle.mockResolvedValue({ data: null, error: null })
    const res = await handler({ pending_id: 'p1', action: 'allow' })
    expect(res.isError).toBe(true)
  })
})
