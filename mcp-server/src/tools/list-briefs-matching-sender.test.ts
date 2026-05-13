import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOrder = vi.fn()
const mockEq = vi.fn(() => ({ order: mockOrder }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./list-briefs-matching-sender.js')

describe('list-briefs-matching-sender', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters by wildcard pattern in memory', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 'b1', sender_email: 'a@x.com', raw_subject: 's1', received_at: 't', status: 'new' },
        { id: 'b2', sender_email: 'b@y.com', raw_subject: 's2', received_at: 't', status: 'new' },
        { id: 'b3', sender_email: 'c@x.com', raw_subject: 's3', received_at: 't', status: 'new' },
      ],
      error: null,
    })
    const res = await handler({ client_id: 'c1', pattern: '*@x.com' })
    const parsed = JSON.parse(res.content[0].text)
    expect(parsed.briefs.map((b: { id: string }) => b.id)).toEqual(['b1', 'b3'])
  })

  it('matches exact email pattern', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 'b1', sender_email: 'greg@x.com', raw_subject: 's1', received_at: 't', status: 'new' },
        { id: 'b2', sender_email: 'sam@x.com', raw_subject: 's2', received_at: 't', status: 'new' },
      ],
      error: null,
    })
    const res = await handler({ client_id: 'c1', pattern: 'greg@x.com' })
    const parsed = JSON.parse(res.content[0].text)
    expect(parsed.briefs.map((b: { id: string }) => b.id)).toEqual(['b1'])
  })
})
