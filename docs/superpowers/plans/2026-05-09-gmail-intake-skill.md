# Gmail Intake Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/intake` Claude Code skill that scans Gmail for labeled threads, reads client wiki context, creates briefs in cc-service-calculator via MCP, stores all messages, classifies intent, and generates scope or draft reply inline — designed to run on `/loop 5m /intake`.

**Architecture:** Two new tools (`sync-messages`, `set-brief-intent`) are added to the cc-calculator MCP server following the existing Zod + async handler pattern. The skill itself lives at `~/.claude/skills/intake/` and orchestrates Gmail MCP → cc-vault MCP → cc-calculator MCP in sequence per thread. No Edge Functions. No ClickUp. Classification runs inline during the skill session.

**Tech Stack:** TypeScript + Zod + Vitest (MCP tools); Markdown skill files; Gmail MCP (`mcp__claude_ai_Gmail__*`); cc-vault MCP (`mcp__cc-vault__*`); cc-calculator MCP (`mcp__cc-calculator__*`). All DB migrations (0023 `brief_messages`, 0029 `intent_type`/`draft_reply`/`scope_type`) are already applied.

**Spec:** `docs/superpowers/specs/2026-05-09-gmail-intake-skill-design.md`

---

## File structure

```
mcp-server/src/tools/
  sync-messages.ts          # NEW — idempotent message upsert tool
  sync-messages.test.ts     # NEW — unit tests (Supabase mocked)
  set-brief-intent.ts       # NEW — update brief intent + store scope/draft_reply
  set-brief-intent.test.ts  # NEW — unit tests (Supabase mocked)

mcp-server/src/index.ts     # MODIFY — register 2 new tools

~/Github/CC-Vault/
  wiki/config/quick-response-rules.md   # NEW — keyword rules for pre-filter

~/.claude/skills/intake/
  SKILL.md                              # NEW — main skill entry point
  references/intent-classification.md  # NEW — five intent types + output templates
  references/failure-modes.md          # NEW — per-condition handling table
```

---

## Task 1: `sync-messages` MCP tool (TDD)

**Files:**
- Create: `mcp-server/src/tools/sync-messages.ts`
- Create: `mcp-server/src/tools/sync-messages.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/src/tools/sync-messages.test.ts`:

```typescript
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

  it('handles mixed new and duplicate messages', async () => {
    mockSelect.mockResolvedValue({ data: [{ id: 'row-1' }], error: null })
    const msg2 = { ...baseMessage, gmail_message_id: 'msg-2' }
    const result = await handler({ brief_id: 'brief-1', messages: [baseMessage, msg2] })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ inserted: 1, skipped: 1 })
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mcp-server && npm test -- sync-messages
```

Expected: FAIL — `sync-messages.js` not found.

- [ ] **Step 3: Write the implementation**

Create `mcp-server/src/tools/sync-messages.ts`:

```typescript
import { z } from 'zod'
import { supabase } from '../supabase.js'

const messageSchema = z.object({
  gmail_message_id: z.string().describe('Unique Gmail message ID — dedup key'),
  direction: z.enum(['inbound', 'outbound']).describe('inbound = from client, outbound = from team'),
  from_email: z.string().describe('Sender email address'),
  from_name: z.string().optional().describe('Sender display name'),
  to_emails: z.array(z.string()).default([]),
  cc_emails: z.array(z.string()).default([]),
  subject: z.string().optional().describe('Message subject line'),
  body_text: z.string().optional().describe('Plain text body'),
  sent_at: z.string().describe('ISO 8601 timestamp'),
})

export const schema = z.object({
  brief_id: z.string().describe('UUID of the parent brief'),
  messages: z.array(messageSchema).min(1).describe('Messages to sync — duplicates are silently skipped'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const rows = input.messages.map(m => ({
      brief_id: input.brief_id,
      gmail_message_id: m.gmail_message_id,
      direction: m.direction,
      from_email: m.from_email,
      from_name: m.from_name ?? null,
      to_emails: m.to_emails,
      cc_emails: m.cc_emails,
      subject: m.subject ?? null,
      body_text: m.body_text ?? null,
      sent_at: m.sent_at,
    }))

    const { data, error } = await supabase
      .from('brief_messages')
      .upsert(rows, { onConflict: 'gmail_message_id', ignoreDuplicates: true })
      .select('id')

    if (error) throw new Error(error.message)

    const inserted = data?.length ?? 0
    const skipped = input.messages.length - inserted

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ inserted, skipped }) }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mcp-server && npm test -- sync-messages
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/tools/sync-messages.ts mcp-server/src/tools/sync-messages.test.ts
git commit -m "feat(mcp): add sync-messages tool — idempotent brief_messages upsert"
```

---

## Task 2: `set-brief-intent` MCP tool (TDD)

**Files:**
- Create: `mcp-server/src/tools/set-brief-intent.ts`
- Create: `mcp-server/src/tools/set-brief-intent.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/src/tools/set-brief-intent.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBriefUpdate = vi.fn()
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
  it('updates intent_type on brief for quick_response (no scope row)', async () => {
    const result = await handler({
      brief_id: 'brief-1',
      intent_type: 'quick_response',
      draft_reply: 'Thanks for reaching out, we will confirm shortly.',
    })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed).toEqual({ updated: true })
    expect(mockFrom).toHaveBeenCalledWith('briefs')
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mcp-server && npm test -- set-brief-intent
```

Expected: FAIL — `set-brief-intent.js` not found.

- [ ] **Step 3: Write the implementation**

Create `mcp-server/src/tools/set-brief-intent.ts`:

```typescript
import { z } from 'zod'
import { supabase } from '../supabase.js'

const scopeSchema = z.object({
  enhanced_prose: z.string().describe('AI-generated prose summary of what is in scope'),
  in_scope_md: z.string().describe('Markdown bullet list of in-scope items'),
  out_of_scope_md: z.string().describe('Markdown bullet list of out-of-scope items'),
  open_questions_md: z.string().describe('Markdown bullet list of clarifying questions'),
  scope_type: z.enum(['new_brief', 'project_thread', 'retainer_thread', 'general_query']),
})

export const schema = z.object({
  brief_id: z.string().describe('UUID of the brief to update'),
  intent_type: z.enum(['new_brief', 'project_thread', 'retainer_thread', 'general_query', 'quick_response']),
  draft_reply: z.string().optional().describe('Draft reply text — populate for quick_response only'),
  scope: scopeSchema.optional().describe('Scope output — populate for all types except quick_response'),
})

type Input = z.infer<typeof schema>

export async function handler(input: Input) {
  try {
    const { error: briefError } = await supabase
      .from('briefs')
      .update({
        intent_type: input.intent_type,
        ...(input.draft_reply !== undefined ? { draft_reply: input.draft_reply } : {}),
      })
      .eq('id', input.brief_id)

    if (briefError) throw new Error(briefError.message)

    if (input.scope) {
      const { error: scopeError } = await supabase
        .from('scopes')
        .upsert(
          {
            brief_id: input.brief_id,
            enhanced_prose: input.scope.enhanced_prose,
            in_scope_md: input.scope.in_scope_md,
            out_of_scope_md: input.scope.out_of_scope_md,
            open_questions_md: input.scope.open_questions_md,
            scope_type: input.scope.scope_type,
          },
          { onConflict: 'brief_id' },
        )

      if (scopeError) throw new Error(scopeError.message)
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ updated: true }) }],
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mcp-server && npm test -- set-brief-intent
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/tools/set-brief-intent.ts mcp-server/src/tools/set-brief-intent.test.ts
git commit -m "feat(mcp): add set-brief-intent tool — update brief intent + scope/draft_reply"
```

---

## Task 3: Wire new tools into `index.ts` and run full test suite

**Files:**
- Modify: `mcp-server/src/index.ts`

- [ ] **Step 1: Add imports and registrations**

Open `mcp-server/src/index.ts`. After the existing imports, add:

```typescript
import * as syncMessages from './tools/sync-messages.js'
import * as setBriefIntent from './tools/set-brief-intent.js'
```

After the last existing `server.tool(...)` call (the `create-brief` registration) and before `const transport = new StdioServerTransport()`, add:

```typescript
server.tool(
  'sync-messages',
  'Idempotently insert new Gmail messages into brief_messages. Skips any gmail_message_id already stored. Returns { inserted, skipped }.',
  rawShape(syncMessages.schema),
  h(syncMessages.handler),
)

server.tool(
  'set-brief-intent',
  'Update a brief with its AI-classified intent_type and store scope fields or draft_reply. Upserts scope row on conflict with brief_id.',
  rawShape(setBriefIntent.schema),
  h(setBriefIntent.handler),
)
```

- [ ] **Step 2: Run the full test suite**

```bash
cd mcp-server && npm test
```

Expected: all 16 existing tests + 10 new tests = 26 PASS, 0 FAIL.

- [ ] **Step 3: Commit**

```bash
git add mcp-server/src/index.ts
git commit -m "feat(mcp): register sync-messages and set-brief-intent tools"
```

---

## Task 4: Quick-response rules config in cc-vault

**Files:**
- Create: `/Users/brendangunn/Github/CC-Vault/wiki/config/quick-response-rules.md`

This file is read by the intake skill at runtime. New rules can be added here without any code change.

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p /Users/brendangunn/Github/CC-Vault/wiki/config
```

Create `/Users/brendangunn/Github/CC-Vault/wiki/config/quick-response-rules.md`:

```markdown
---
type: config
title: Quick-Response Pre-Filter Rules
description: Keyword signals that identify emails needing a brief reply only — no scope required. Checked before any AI classification call.
updated: 2026-05-09
---

# Quick-Response Pre-Filter Rules

If the inbound message body contains any of these phrases (case-insensitive), classify as `quick_response` before running full intent classification:

## Rescheduling / logistics
- reschedule
- postpone
- push the meeting
- move our call
- can we push
- when are you available
- what time works
- availability

## Acknowledgements
- got it
- received
- noted
- thanks for sending
- thanks for the update
- thank you for confirming
- confirmed
- sounds good
- perfect thanks
- all good

## Following up
- just following up
- checking in
- any update
- have you had a chance
- wanted to follow up

## Rules for applying
- Match against the plain text body of the **latest inbound message only**
- Minimum 3 words must match (single-word matches like "noted" count as 1; "got it" counts as 2)
- If body also contains project names, deliverables, or budget figures → do NOT classify as quick_response; proceed to full classification
- When in doubt, do NOT classify as quick_response — full classification is safer
```

- [ ] **Step 2: Commit to cc-vault**

```bash
cd /Users/brendangunn/Github/CC-Vault
git add wiki/config/quick-response-rules.md
git commit -m "config: add quick-response pre-filter rules for intake skill"
```

---

## Task 5: `intent-classification.md` reference file

**Files:**
- Create: `~/.claude/skills/intake/references/intent-classification.md`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p ~/.claude/skills/intake/references
```

- [ ] **Step 2: Create the file**

Create `~/.claude/skills/intake/references/intent-classification.md`:

```markdown
# Intent Classification Reference

Read this file when you need to classify a brief's intent_type during the intake loop.

## Step 1: Quick-response pre-filter

Before any inference, run this check against the latest inbound message body:

1. Read `wiki/config/quick-response-rules.md` from cc-vault using `mcp__cc-vault__read_note` with path `wiki/config/quick-response-rules.md`.
2. Check if the message body contains any of the listed phrases (case-insensitive).
3. If matched AND the body does NOT contain project names, deliverables, or budget figures → classify as `quick_response`. Skip to Step 3 (generate draft reply).
4. If not matched → proceed to Step 2.

## Step 2: Full intent classification

Use the wiki context already loaded for the client plus the message content:

| Intent | When to use |
|---|---|
| `retainer_thread` | Wiki context contains an active retainer note for this client (look for notes with `type: retainer` or a retainer section in the client index). Message is a task within that retainer. |
| `project_thread` | Message body explicitly references the name of an active project visible in the wiki context. Use `get-active-projects` tool to confirm. |
| `general_query` | Message is a question, advice request, or planning discussion with no specific deliverable asked for. No budget, no timeline, no asset type requested. |
| `new_brief` | Everything else — new work, a new asset, a new campaign, something not matching any active project or retainer. Default when uncertain. |

**When uncertain: default to `new_brief`.** A full scope draft on a retainer task is better than a missed brief.

## Step 3: Generate output by intent type

### `quick_response`

Generate a brief, professional reply draft in Brendan's voice. Tone: warm, direct, no corporate filler.

Template:
```
Hi [first name],

[1-2 sentence response addressing the logistics/acknowledgement directly]

[Sign-off]
Brendan
```

Store via `set-brief-intent`: `{ intent_type: 'quick_response', draft_reply: '<text>' }`. Do NOT provide a `scope` object.

### `new_brief`

Generate a full scope using the client wiki context and message content:

- **enhanced_prose**: 2-3 paragraph summary of what the client is asking for, clarified and de-jargoned. What is the actual ask?
- **in_scope_md**: bullet list of deliverables that are clearly included based on the request and the client's existing service scope from the wiki.
- **out_of_scope_md**: bullet list of items that are adjacent but NOT included — set clear boundaries.
- **open_questions_md**: bullet list of things that need clarification before scoping is complete.

Store via `set-brief-intent`: `{ intent_type: 'new_brief', scope: { ..., scope_type: 'new_brief' } }`.

### `project_thread`

Generate a change-request scope:

- **enhanced_prose**: summary of the change request in context of the active project.
- **in_scope_md**: what parts of this request are already covered by the active project scope (from wiki).
- **out_of_scope_md**: what falls outside the current project scope and would be a change order.
- **open_questions_md**: clarifications needed.

Store via `set-brief-intent`: `{ intent_type: 'project_thread', scope: { ..., scope_type: 'project_thread' } }`.

### `retainer_thread`

Generate a retainer coverage check:

- **enhanced_prose**: summary of the client's request in context of their retainer.
- **in_scope_md**: what is covered by the retainer (draw from wiki retainer context).
- **out_of_scope_md**: what exceeds the retainer and would be additional cost.
- **open_questions_md**: capacity or timing questions.

Store via `set-brief-intent`: `{ intent_type: 'retainer_thread', scope: { ..., scope_type: 'retainer_thread' } }`.

### `general_query`

Generate a research + response notes summary:

- **enhanced_prose**: summary of the question/topic with initial thinking.
- **in_scope_md**: key topics to address in a response.
- **out_of_scope_md**: leave empty (`""`).
- **open_questions_md**: anything that needs clarification before responding.

Store via `set-brief-intent`: `{ intent_type: 'general_query', scope: { ..., scope_type: 'general_query' } }`.
```

- [ ] **Step 3: Verify the file was created**

```bash
cat ~/.claude/skills/intake/references/intent-classification.md | head -5
```

Expected: frontmatter header visible.

---

## Task 6: `failure-modes.md` reference file

**Files:**
- Create: `~/.claude/skills/intake/references/failure-modes.md`

- [ ] **Step 1: Create the file**

Create `~/.claude/skills/intake/references/failure-modes.md`:

```markdown
# Failure Modes

Read this file when you encounter an error condition during the intake loop. Handle per-thread errors gracefully — never let one thread failure abort the rest of the batch.

## Per-thread error handling

| Condition | Action |
|---|---|
| Gmail MCP `get_thread` fails | Log: `⚠ Thread <id>: Gmail fetch failed — skipping`. Continue to next thread. |
| `find-client` returns null (unknown sender) | Create brief with no `client_id`. Set `status: 'new'`. Skip classification and scope generation. Log: `⚠ <sender_email>: unknown client — brief stored, no scope generated`. |
| `create-brief` returns error | Log: `⚠ Thread <id>: create-brief failed: <error>`. Skip remaining steps for this thread. Continue. |
| `sync-messages` returns error | Log: `⚠ Brief <id>: sync-messages failed: <error>`. Brief exists. Continue to next thread — messages can be re-synced on next tick. |
| All messages already synced (inserted: 0) | Skip classification entirely. Log: `✓ Thread <id>: no new messages`. |
| Thread has only outbound messages (all direction=outbound) | Sync messages. Skip classification (no inbound to classify). Log: `✓ Thread <id>: outbound only — messages stored, no classification`. |
| cc-vault MCP `read_note` fails | Log the warning. Continue with classification using only the message content (no wiki context). Use `new_brief` as default intent unless message content makes another type obvious. |
| Classification result is ambiguous | Default to `new_brief`. Log: `⚠ Brief <id>: intent ambiguous — defaulted to new_brief`. |
| `set-brief-intent` fails | Log: `⚠ Brief <id>: set-brief-intent failed: <error>`. Brief and messages are stored. Classification can be retried manually via `/intake <thread-url>`. |

## Session-level errors

| Condition | Action |
|---|---|
| Gmail MCP unavailable at session start | Stop. Output: `Gmail MCP unreachable — cannot run intake. Reconnect and retry.` |
| cc-calculator MCP unavailable at session start | Stop. Output: `cc-calculator MCP unreachable — cannot run intake. Reconnect and retry.` |
| Gmail label `→Inbox/Push` does not exist | Log warning: `Label →Inbox/Push not found in Gmail — no threads to scan`. End tick silently (this is not an error on a /loop). |
| Zero threads found | End tick silently. Do not log anything — quiet ticks are normal. |

## Hard rule

**Never abort the full batch on a single thread failure.** Wrap each thread in try/catch. Log the failure with thread ID and continue. The summary at the end of each tick should list any per-thread failures so they can be investigated.
```

- [ ] **Step 2: Verify the file was created**

```bash
cat ~/.claude/skills/intake/references/failure-modes.md | head -5
```

Expected: `# Failure Modes` header visible.

---

## Task 7: `SKILL.md` — main skill entry point

**Files:**
- Create: `~/.claude/skills/intake/SKILL.md`

- [ ] **Step 1: Create the main skill file**

Create `~/.claude/skills/intake/SKILL.md`:

````markdown
---
name: intake
description: >
  Scans Gmail for threads labeled →Inbox/Push or →Inbox/Push-Sent, reads client
  wiki context from cc-vault, creates/updates briefs in cc-service-calculator,
  stores all messages (inbound + outbound), classifies intent inline, and
  generates scope or draft reply. Designed to run on /loop 5m or /loop 10m.
  Triggers: "/intake", "/loop 5m /intake", "/loop 10m /intake".
allowed-tools: >
  Read
  mcp__claude_ai_Gmail__search_threads
  mcp__claude_ai_Gmail__get_thread
  mcp__cc-vault__read_note
  mcp__cc-vault__search_notes
  mcp__cc-calculator__find-client
  mcp__cc-calculator__check-duplicate-brief
  mcp__cc-calculator__create-brief
  mcp__cc-calculator__get-brief
  mcp__cc-calculator__sync-messages
  mcp__cc-calculator__set-brief-intent
---

# /intake — Gmail Intake Skill

Converts labeled Gmail threads into briefs in cc-service-calculator. Runs silently when nothing is new. Generates scope or draft reply when new inbound messages arrive.

## Core philosophy

- **Idempotent always.** Every operation is safe to re-run. Duplicate messages are skipped at the DB layer. Running this twice on the same threads produces the same result.
- **Never block on one thread.** Per-thread failures are logged and skipped. The batch always finishes.
- **Quiet when idle.** Zero new messages = zero output. The /loop cadence is invisible when nothing changes.
- **Generate, never send.** Draft replies and scopes are stored for human review. Nothing is sent automatically.

## Per-tick algorithm

### 1. Scan Gmail

```
mcp__claude_ai_Gmail__search_threads
  query: 'label:"→Inbox/Push" OR label:"→Inbox/Push-Sent"'
  maxResults: 20
```

If zero threads → end tick silently.

### 2. For each thread (wrap in try/catch — see references/failure-modes.md)

**a. Find client**
```
mcp__cc-calculator__find-client
  email_domain: <domain parsed from sender email of latest message>
```
→ `{ id, name, wiki_path }` or null.

**b. Read wiki context** (skip if client not found)
```
mcp__cc-vault__read_note
  path: wiki/clients/<slug>/index.md
```
If the path fails, also try:
```
mcp__cc-vault__search_notes
  query: <client name>
  limit: 5
```
Use this context for awareness during classification — not stored anywhere.

**c. Create brief** (idempotent)
```
mcp__cc-calculator__create-brief
  gmail_thread_id: <thread id>
  subject: <subject of latest message>
  body: <plain text body of latest inbound message>
  sender_email: <sender of latest inbound message>
  sender_name: <sender display name, if available>
  client_id: <id from find-client, omit if null>
```
→ `{ brief_id, created: bool }`

**d. Fetch all messages from thread**
```
mcp__claude_ai_Gmail__get_thread
  threadId: <thread id>
```
For each message, determine direction:
- `from_email` ends with `@convertedclick.co.za` → `outbound`
- Otherwise → `inbound`

**e. Sync messages**
```
mcp__cc-calculator__sync-messages
  brief_id: <brief_id>
  messages: [{ gmail_message_id, direction, from_email, from_name, to_emails, cc_emails, subject, body_text, sent_at }]
```
→ `{ inserted: N, skipped: M }`

**f. Classify and generate** (only if `inserted > 0` AND at least one new message is `inbound`)

First check if intent_type is already set:
```
mcp__cc-calculator__get-brief
  brief_id: <brief_id>
```
→ if `intent_type` is not null → skip classification (set once, never overwritten).
→ if `intent_type` is null → read `references/intent-classification.md` and follow it exactly.

**g. Store result**
```
mcp__cc-calculator__set-brief-intent
  brief_id: <brief_id>
  intent_type: <classified type>
  draft_reply: <text>          ← quick_response only
  scope: { ... }               ← all other types
```

### 3. End-of-tick summary

Always print a summary, even if nothing was ingested:

```
Intake tick complete.
Scanned: 12 threads
New messages: 3 (across 2 threads)
  - Acme Co (jane@acme.co.za): new_brief — scope drafted ✓
  - Pebble (mike@pebble.co): quick_response — draft reply stored ✓
Skipped: 10 threads (no new messages)
Errors: 0
```

If errors occurred:
```
Errors: 1
  ⚠ Thread abc123: sync-messages failed: FK violation on brief_id
```

## Hard rules

- ❌ Never remove or modify Gmail labels — read-only on Gmail.
- ❌ Never send an email reply — draft replies are stored for human review only.
- ❌ Never touch ClickUp — that is Stage 6 (`/brief`).
- ❌ Never classify if `inserted == 0` — no new messages means nothing to classify.
- ❌ Never reclassify a brief that already has an `intent_type` — set once, not overwritten.
- ❌ Never let one thread failure abort the batch — catch per-thread, log, continue.

## References

- `references/intent-classification.md` — five intent types, pre-filter rules, output templates for each type
- `references/failure-modes.md` — per-condition error handling table
````

- [ ] **Step 2: Verify the skill is registered**

Restart Claude Code (or open a new session). Run `/intake` with no args.

Expected: skill is recognised and begins a scan tick.

---

## Task 8: Smoke test

No new files — execution and verification only.

- [ ] **Step 1: Apply a test label in Gmail**

In Gmail, find one real client thread. Apply the label `→Inbox/Push` to it. (Create the label first if it doesn't exist: Gmail → Settings → Labels → Create new label → `→Inbox/Push`.)

- [ ] **Step 2: Run the skill manually**

In a Claude Code session (in any directory — the skill is user-level):

```
/intake
```

Expected: skill scans, finds the labeled thread, creates a brief, syncs messages, classifies intent, stores result. Prints summary.

- [ ] **Step 3: Verify in the calculator app**

Open the cc-service-calculator app at `http://localhost:5174`. Navigate to Inbox. Confirm:
- The brief appears with the correct sender, subject, and client
- `intent_type` is populated
- If `quick_response`: draft reply is visible in the brief detail
- If other: scope fields are populated

- [ ] **Step 4: Run again immediately**

```
/intake
```

Expected: same thread found, `inserted: 0, skipped: N`. No duplicate brief. Summary shows "no new messages."

- [ ] **Step 5: Test the loop**

```
/loop 5m /intake
```

Expected: first tick runs immediately, subsequent ticks run every 5 minutes. On a quiet tick with no new threads, summary is suppressed or minimal.

- [ ] **Step 6: Final commit**

```bash
cd /Users/brendangunn/Github/cc-service-calculator
git add docs/superpowers/plans/2026-05-09-gmail-intake-skill.md
git commit -m "docs: Gmail intake skill implementation plan"
```
