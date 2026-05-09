import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSingle = vi.fn()
const mockEq = vi.fn(() => ({ single: mockSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./get-brief.js')

describe('get-brief', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns full brief with scope', async () => {
    const brief = {
      id: 'b1', raw_subject: 'New site', raw_body: 'We need...', sender_email: 'a@b.com',
      status: 'new', intent_type: 'new_brief', draft_reply: null,
      scopes: { enhanced_prose: 'Summary', in_scope_md: '- Website', out_of_scope_md: '', open_questions_md: '- Budget?', scope_type: 'new_brief' },
    }
    mockSingle.mockResolvedValue({ data: brief, error: null })
    const result = await handler({ brief_id: 'b1' })
    expect(JSON.parse(result.content[0].text)).toEqual(brief)
    expect(mockEq).toHaveBeenCalledWith('id', 'b1')
  })

  it('returns error content on not found', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const result = await handler({ brief_id: 'missing' })
    expect(result.isError).toBe(true)
  })
})
