import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()
const mockUpsert = vi.fn(() => ({ select: mockSelect }))
const mockFrom = vi.fn(() => ({ upsert: mockUpsert }))

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
  beforeEach(() => vi.clearAllMocks())

  it('inserts new messages and returns inserted count', async () => {
    mockSelect.mockResolvedValue({ data: [{ id: 'row-1' }], error: null })
    const result = await handler({ brief_id: 'brief-1', messages: [baseMessage] })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ inserted: 1, skipped: 0 })
    expect(mockUpsert).toHaveBeenCalledWith(
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
    mockSelect.mockResolvedValue({ data: [], error: null })
    const result = await handler({ brief_id: 'brief-1', messages: [baseMessage] })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ inserted: 0, skipped: 1 })
  })

  it('maps optional fields to null when omitted', async () => {
    mockSelect.mockResolvedValue({ data: [{ id: 'row-1' }], error: null })
    const minimal = {
      gmail_message_id: 'msg-3',
      direction: 'outbound' as const,
      from_email: 'brendan@convertedclick.co.za',
      to_emails: ['client@acme.co.za'],
      cc_emails: [],
      sent_at: '2026-05-09T10:00:00+02:00',
    }
    await handler({ brief_id: 'brief-1', messages: [minimal] })
    expect(mockUpsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        from_name: null,
        subject: null,
        body_text: null,
      })],
      expect.any(Object),
    )
  })

  it('returns error object on Supabase failure', async () => {
    mockSelect.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const result = await handler({ brief_id: 'brief-1', messages: [baseMessage] })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.error).toContain('DB error')
  })
})
