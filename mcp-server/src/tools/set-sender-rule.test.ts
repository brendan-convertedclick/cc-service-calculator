import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSingle = vi.fn()
const mockSelect = vi.fn(() => ({ single: mockSingle }))
const mockUpsert = vi.fn(() => ({ select: mockSelect }))

const mockDelEq2 = vi.fn(() => Promise.resolve({ error: null }))
const mockDelEq1 = vi.fn(() => ({ eq: mockDelEq2 }))
const mockDelete = vi.fn(() => ({ eq: mockDelEq1 }))

const mockFrom = vi.fn(() => ({ upsert: mockUpsert, delete: mockDelete }))
vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./set-sender-rule.js')

describe('set-sender-rule', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lowercases pattern and upserts', async () => {
    mockSingle.mockResolvedValue({ data: { id: 'r1', pattern: 'a@x.com', mode: 'block' }, error: null })
    const res = await handler({ client_id: 'c1', pattern: 'A@X.com', mode: 'block' })
    expect(JSON.parse(res.content[0].text)).toEqual({ id: 'r1', pattern: 'a@x.com', mode: 'block' })
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: 'a@x.com', mode: 'block' }),
      { onConflict: 'client_id,pattern' },
    )
  })

  it('rejects patterns without @', async () => {
    const res = await handler({ client_id: 'c1', pattern: 'x.com', mode: 'allow' })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('email or *@domain')
  })

  it('deletes when delete=true', async () => {
    const res = await handler({ client_id: 'c1', pattern: 'a@x.com', delete: true })
    expect(JSON.parse(res.content[0].text)).toEqual({ deleted: true })
    expect(mockDelete).toHaveBeenCalled()
  })
})
