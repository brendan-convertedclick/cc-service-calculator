import { describe, it, expect, vi, beforeEach } from 'vitest'

// briefs.select('client_id').eq('id', ...).maybeSingle()
const mockBriefsMaybeSingle = vi.fn()
const mockBriefsEq = vi.fn(() => ({ maybeSingle: mockBriefsMaybeSingle }))
const mockBriefsSelect = vi.fn(() => ({ eq: mockBriefsEq }))

// client_sender_rules.select(...).eq(...)
const mockRulesEq = vi.fn()
const mockRulesSelect = vi.fn(() => ({ eq: mockRulesEq }))

// brief_messages.upsert(...).select('id')
const mockMessagesSelect = vi.fn()
const mockMessagesUpsert = vi.fn(() => ({ select: mockMessagesSelect }))

const mockFrom = vi.fn((table: string) => {
  if (table === 'briefs') return { select: mockBriefsSelect }
  if (table === 'client_sender_rules') return { select: mockRulesSelect }
  if (table === 'brief_messages') return { upsert: mockMessagesUpsert }
  return {}
})

vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./sync-messages.js')

const baseMessage = {
  gmail_message_id: 'msg-1',
  direction: 'inbound' as const,
  from_email: 'client@acme.co.za',
  from_name: 'Jane',
  to_emails: ['brendan@convertedclick.co.za'],
  cc_emails: [],
  subject: 'Project request',
  body_text: 'Hi, we need a new website.',
  sent_at: '2026-05-09T09:00:00+02:00',
}

describe('sync-messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBriefsMaybeSingle.mockResolvedValue({ data: { client_id: null }, error: null })
    mockRulesEq.mockResolvedValue({ data: [], error: null })
  })

  it('inserts new messages and returns inserted count', async () => {
    mockMessagesSelect.mockResolvedValue({ data: [{ id: 'row-1' }], error: null })
    const result = await handler({ brief_id: 'brief-1', messages: [baseMessage] })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ inserted: 1, skipped: 0, dropped: 0 })
    expect(mockMessagesUpsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        brief_id: 'brief-1',
        gmail_message_id: 'msg-1',
        direction: 'inbound',
        from_email: 'client@acme.co.za',
      })],
      { onConflict: 'gmail_message_id', ignoreDuplicates: true },
    )
  })

  it('returns skipped count when all messages already exist', async () => {
    mockMessagesSelect.mockResolvedValue({ data: [], error: null })
    const result = await handler({ brief_id: 'brief-1', messages: [baseMessage] })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ inserted: 0, skipped: 1, dropped: 0 })
  })

  it('maps optional fields to null when omitted', async () => {
    mockMessagesSelect.mockResolvedValue({ data: [{ id: 'row-1' }], error: null })
    const minimal = {
      gmail_message_id: 'msg-3',
      direction: 'outbound' as const,
      from_email: 'brendan@convertedclick.co.za',
      to_emails: ['client@acme.co.za'],
      cc_emails: [],
      sent_at: '2026-05-09T10:00:00+02:00',
    }
    await handler({ brief_id: 'brief-1', messages: [minimal] })
    expect(mockMessagesUpsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        from_name: null,
        subject: null,
        body_text: null,
      })],
      expect.any(Object),
    )
  })

  it('returns error object on Supabase failure', async () => {
    mockMessagesSelect.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const result = await handler({ brief_id: 'brief-1', messages: [baseMessage] })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error).toContain('DB error')
  })

  it('drops inbound messages matching a block rule and reports dropped count', async () => {
    mockBriefsMaybeSingle.mockResolvedValue({ data: { client_id: 'c1' }, error: null })
    mockRulesEq.mockResolvedValue({
      data: [{ id: 'r1', pattern: 'greg@x.com', mode: 'block' }],
      error: null,
    })
    mockMessagesSelect.mockResolvedValue({ data: [{ id: 'row-1' }], error: null })
    const result = await handler({
      brief_id: 'brief-1',
      messages: [
        { ...baseMessage, gmail_message_id: 'msg-a', from_email: 'greg@x.com' },
        { ...baseMessage, gmail_message_id: 'msg-b', from_email: 'sam@x.com' },
      ],
    })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ inserted: 1, skipped: 0, dropped: 1 })
    expect(mockMessagesUpsert).toHaveBeenCalledWith(
      [expect.objectContaining({ from_email: 'sam@x.com' })],
      expect.any(Object),
    )
  })
})
