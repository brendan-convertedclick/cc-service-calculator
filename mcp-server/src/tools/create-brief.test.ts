import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFireAutoScope = vi.fn()
vi.mock('../auto-scope.js', () => ({ fireAutoScope: mockFireAutoScope }))

const mockSingleDup = vi.fn()
const mockEqDup = vi.fn(() => ({ maybeSingle: mockSingleDup }))
const mockSelectDup = vi.fn(() => ({ eq: mockEqDup }))

const mockSingleInsert = vi.fn()
const mockSelectInsert = vi.fn(() => ({ single: mockSingleInsert }))
const mockInsert = vi.fn(() => ({ select: mockSelectInsert }))

const mockFrom = vi.fn()
vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./create-brief.js')

describe('create-brief', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'briefs' && mockFrom.mock.calls.filter(c => c[0] === 'briefs').length === 1) {
        return { select: mockSelectDup }
      }
      return { insert: mockInsert }
    })
  })

  it('returns existing brief_id without inserting when duplicate', async () => {
    mockSingleDup.mockResolvedValue({ data: { id: 'existing-brief' }, error: null })
    const result = await handler({ gmail_thread_id: 'thread-1', subject: 'Hi', body: 'Hello', sender_email: 'a@b.com' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ brief_id: 'existing-brief', created: false })
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockFireAutoScope).not.toHaveBeenCalled()
  })

  it('creates brief and fires auto-scope when thread is new', async () => {
    mockSingleDup.mockResolvedValue({ data: null, error: null })
    mockSingleInsert.mockResolvedValue({ data: { id: 'new-brief' }, error: null })
    const result = await handler({ gmail_thread_id: 'thread-2', subject: 'New project', body: 'Details', sender_email: 'a@b.com', client_id: 'client-1' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ brief_id: 'new-brief', created: true })
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      gmail_thread_id: 'thread-2',
      raw_subject: 'New project',
      raw_body: 'Details',
      sender_email: 'a@b.com',
      client_id: 'client-1',
      source: 'gmail_relay',
      status: 'new',
    }))
    expect(mockFireAutoScope).toHaveBeenCalledWith('new-brief')
  })
})
