import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpdateIn = vi.fn(() => Promise.resolve({ error: null }))
const mockUpdate = vi.fn(() => ({ in: mockUpdateIn }))

const mockDeleteIn = vi.fn(() => Promise.resolve({ error: null }))
const mockDelete = vi.fn(() => ({ in: mockDeleteIn }))

const mockFrom = vi.fn(() => ({ update: mockUpdate, delete: mockDelete }))
vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./apply-retro-action.js')

describe('apply-retro-action', () => {
  beforeEach(() => vi.clearAllMocks())

  it('archives via update status=archived', async () => {
    const res = await handler({ brief_ids: ['b1', 'b2'], action: 'archive' })
    expect(JSON.parse(res.content[0].text)).toEqual({ affected: 2, action: 'archive' })
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'archived' })
    expect(mockUpdateIn).toHaveBeenCalledWith('id', ['b1', 'b2'])
  })

  it('deletes via .delete().in(...)', async () => {
    const res = await handler({ brief_ids: ['b1'], action: 'delete' })
    expect(JSON.parse(res.content[0].text)).toEqual({ affected: 1, action: 'delete' })
    expect(mockDelete).toHaveBeenCalled()
    expect(mockDeleteIn).toHaveBeenCalledWith('id', ['b1'])
  })
})
