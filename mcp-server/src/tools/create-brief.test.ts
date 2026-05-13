import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFireAutoScope = vi.fn()
vi.mock('../auto-scope.js', () => ({ fireAutoScope: mockFireAutoScope }))

// briefs.select('id').eq(...).maybeSingle() — duplicate check
const mockBriefsMaybeSingle = vi.fn()
const mockBriefsEq = vi.fn(() => ({ maybeSingle: mockBriefsMaybeSingle }))
const mockBriefsSelectDup = vi.fn(() => ({ eq: mockBriefsEq }))

// briefs.insert(...).select('id').single() — create
const mockBriefsInsertSingle = vi.fn()
const mockBriefsInsertSelect = vi.fn(() => ({ single: mockBriefsInsertSingle }))
const mockBriefsInsert = vi.fn(() => ({ select: mockBriefsInsertSelect }))

// client_sender_rules.select(...).eq(...) — rules lookup
const mockRulesEq = vi.fn()
const mockRulesSelect = vi.fn(() => ({ eq: mockRulesEq }))

// pending_senders.upsert(...) — pending queue
const mockPendingUpsert = vi.fn(() => Promise.resolve({ data: null, error: null }))

const mockFrom = vi.fn()
vi.mock('../supabase.js', () => ({ supabase: { from: mockFrom } }))

const { handler } = await import('./create-brief.js')

function setupBriefsFlow() {
  let briefsCall = 0
  mockFrom.mockImplementation((table: string) => {
    if (table === 'briefs') {
      briefsCall++
      if (briefsCall === 1) return { select: mockBriefsSelectDup }
      return { insert: mockBriefsInsert }
    }
    if (table === 'client_sender_rules') return { select: mockRulesSelect }
    if (table === 'pending_senders') return { upsert: mockPendingUpsert }
    return {}
  })
}

describe('create-brief', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRulesEq.mockResolvedValue({ data: [], error: null })
  })

  it('returns existing brief_id without inserting when duplicate', async () => {
    setupBriefsFlow()
    mockBriefsMaybeSingle.mockResolvedValue({ data: { id: 'existing-brief' }, error: null })
    const result = await handler({ gmail_thread_id: 'thread-1', subject: 'Hi', body: 'Hello', sender_email: 'a@b.com' })
    expect(JSON.parse(result.content[0].text)).toEqual({ brief_id: 'existing-brief', created: false })
    expect(mockBriefsInsert).not.toHaveBeenCalled()
    expect(mockFireAutoScope).not.toHaveBeenCalled()
  })

  it('creates brief and fires auto-scope when thread is new and no rules apply', async () => {
    setupBriefsFlow()
    mockBriefsMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockBriefsInsertSingle.mockResolvedValue({ data: { id: 'new-brief' }, error: null })
    const result = await handler({ gmail_thread_id: 'thread-2', subject: 'New project', body: 'Details', sender_email: 'a@b.com', client_id: 'client-1' })
    expect(JSON.parse(result.content[0].text)).toEqual({ brief_id: 'new-brief', created: true })
    expect(mockBriefsInsert).toHaveBeenCalledWith(expect.objectContaining({
      gmail_thread_id: 'thread-2',
      sender_email: 'a@b.com',
      client_id: 'client-1',
      source: 'gmail_relay',
      status: 'new',
    }))
    expect(mockFireAutoScope).toHaveBeenCalledWith('new-brief')
    // Decision was 'pending' (no rules) but client_id present → pending row queued
    expect(mockPendingUpsert).toHaveBeenCalled()
  })

  it('blocks insert and skips auto-scope when a block rule matches', async () => {
    setupBriefsFlow()
    mockBriefsMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockRulesEq.mockResolvedValue({
      data: [{ id: 'rule-1', pattern: 'greg@x.com', mode: 'block' }],
      error: null,
    })
    const result = await handler({ gmail_thread_id: 'thread-3', subject: 'School', body: 'note', sender_email: 'greg@x.com', client_id: 'client-1' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ blocked: true, reason: 'sender_blocked', rule_id: 'rule-1' })
    expect(mockBriefsInsert).not.toHaveBeenCalled()
    expect(mockFireAutoScope).not.toHaveBeenCalled()
  })

  it('does not queue pending when an allow rule matches', async () => {
    setupBriefsFlow()
    mockBriefsMaybeSingle.mockResolvedValue({ data: null, error: null })
    mockBriefsInsertSingle.mockResolvedValue({ data: { id: 'new-brief' }, error: null })
    mockRulesEq.mockResolvedValue({
      data: [{ id: 'rule-1', pattern: '*@x.com', mode: 'allow' }],
      error: null,
    })
    await handler({ gmail_thread_id: 'thread-4', subject: 'Hi', body: '...', sender_email: 'sam@x.com', client_id: 'client-1' })
    expect(mockPendingUpsert).not.toHaveBeenCalled()
    expect(mockFireAutoScope).toHaveBeenCalled()
  })
})
