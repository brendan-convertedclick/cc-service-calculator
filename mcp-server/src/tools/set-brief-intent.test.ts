import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBriefEq = vi.fn(() => ({ error: null }))

const mockScopeUpsert = vi.fn(() => ({ error: null }))

const mockFrom = vi.fn()
vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./set-brief-intent.js')

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockImplementation((table: string) => {
    if (table === 'briefs') return { update: () => ({ eq: mockBriefEq }) }
    if (table === 'scopes') return { upsert: mockScopeUpsert }
    throw new Error(`Unexpected table: ${table}`)
  })
})

describe('set-brief-intent', () => {
  it('updates intent_type and draft_reply on brief for quick_response (no scope row)', async () => {
    let capturedUpdate: Record<string, unknown> | null = null
    mockFrom.mockImplementation((table: string) => {
      if (table === 'briefs') return {
        update: (payload: Record<string, unknown>) => {
          capturedUpdate = payload
          return { eq: mockBriefEq }
        }
      }
      if (table === 'scopes') return { upsert: mockScopeUpsert }
      throw new Error(`Unexpected table: ${table}`)
    })
    const result = await handler({
      brief_id: 'brief-1',
      intent_type: 'quick_response',
      draft_reply: 'Thanks for reaching out, we will confirm shortly.',
    })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ updated: true })
    expect(capturedUpdate).toEqual({ intent_type: 'quick_response', draft_reply: 'Thanks for reaching out, we will confirm shortly.' })
    expect(mockFrom).not.toHaveBeenCalledWith('scopes')
  })

  it('upserts scope row for new_brief intent', async () => {
    const result = await handler({
      brief_id: 'brief-2',
      intent_type: 'new_brief',
      scope: {
        enhanced_prose: 'Client wants a new website.',
        in_scope_md: '- Homepage\n- Contact page',
        out_of_scope_md: '- E-commerce',
        open_questions_md: '- Timeline?',
        scope_type: 'new_brief',
      },
    })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ updated: true })
    expect(mockFrom).toHaveBeenCalledWith('scopes')
    expect(mockScopeUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        brief_id: 'brief-2',
        enhanced_prose: 'Client wants a new website.',
        scope_type: 'new_brief',
      }),
      { onConflict: 'brief_id' },
    )
  })

  it('does not upsert scope row for quick_response', async () => {
    await handler({ brief_id: 'brief-3', intent_type: 'quick_response' })
    expect(mockFrom).not.toHaveBeenCalledWith('scopes')
  })

  it('returns error object when briefs update fails', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'briefs') return { update: () => ({ eq: vi.fn(() => ({ error: { message: 'update failed' } })) }) }
      return { upsert: mockScopeUpsert }
    })
    const result = await handler({ brief_id: 'brief-4', intent_type: 'general_query' })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error).toContain('update failed')
  })

  it('returns error object when scopes upsert fails', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'briefs') return { update: () => ({ eq: vi.fn(() => ({ error: null })) }) }
      if (table === 'scopes') return { upsert: vi.fn(() => ({ error: { message: 'scope upsert failed' } })) }
      throw new Error(`Unexpected table: ${table}`)
    })
    const result = await handler({
      brief_id: 'brief-5',
      intent_type: 'new_brief',
      scope: {
        enhanced_prose: 'x', in_scope_md: 'x', out_of_scope_md: 'x',
        open_questions_md: 'x', scope_type: 'new_brief',
      },
    })
    expect(result.isError).toBe(true)
  })
})
