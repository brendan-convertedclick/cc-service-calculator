# Design: `/intake` skill — Gmail ingestion into cc-service-calculator

**Date:** 2026-05-09
**Author:** Brendan Gunn (with Claude)
**Status:** Approved for implementation planning

---

## Problem

Client emails arrive in individual team members' Gmail inboxes and have no path into the cc-service-calculator without manual copy-paste. There is no record of outbound replies alongside the original request, no automatic client context from the wiki, and no classification of what kind of request it actually is — making scoping, briefing, and team handoff slower than it needs to be.

The cc-calculator MCP server was explicitly built to support a Gmail intake agent as its primary consumer (MCP Server Architectural Decisions D1). This skill is that agent.

---

## Goal

A Claude Code skill invoked on a `/loop 5m /intake` (or `/loop 10m /intake`) cadence that:

1. Scans Gmail for threads marked for ingestion
2. Reads client wiki context for awareness
3. Creates or updates a brief in the cc-service-calculator via the MCP
4. Stores every message (inbound + outbound) in `brief_messages`
5. Classifies the intent of the request
6. Generates the appropriate output inline (draft reply or scope) and stores it on the brief

No Edge Functions. No Apps Script relay. No ClickUp at this stage. Everything runs inside the Claude session using MCP tools.

---

## Decisions locked

| Decision | Chosen |
|---|---|
| Skill location | `~/.claude/skills/intake/` |
| Trigger | `/loop 5m /intake` (default 5 min; 10 min also valid) |
| Thread discovery | Gmail label `→Inbox/Push` applied once by teammate — means "this thread is relevant forever" |
| Message dedup | `brief_messages.gmail_message_id` unique key in Supabase — checked server-side in `sync-messages` |
| Direction detection | Per-message: `from_email == brendan@convertedclick.co.za` → `outbound`, else `inbound` |
| Wiki context | Read at intake time for agent awareness; not stored on brief (auto-scope pipeline fetches fresh at scope time) |
| Classification | Inline by Claude — no Edge Function needed |
| Loop cadence | 5–10 minutes; no Edge Function firing |
| ClickUp | Not touched by this skill — that is `/brief` (Stage 6) |

---

## MCP stack

| MCP | Tools used |
|---|---|
| `mcp__claude_ai_Gmail__*` | `search_threads`, `get_thread` |
| `mcp__cc-vault__*` | `read_note`, `search_notes` |
| `mcp__cc-calculator__*` | `find-client`, `check-duplicate-brief`, `create-brief`, `sync-messages` (new), `set-brief-intent` (new) |

The two new cc-calculator MCP tools are specified below.

---

## New MCP tools (additions to `mcp-server/`)

### `sync-messages`

Idempotently inserts new messages into `brief_messages`. Skips any `gmail_message_id` that already exists. Returns count of newly inserted rows.

**Input schema:**
```typescript
{
  brief_id: string,           // UUID of the parent brief
  messages: Array<{
    gmail_message_id: string,
    direction: 'inbound' | 'outbound',
    from_email: string,
    from_name?: string,
    to_emails: string[],
    cc_emails: string[],
    subject: string,
    body_text: string,
    sent_at: string,          // ISO 8601
  }>
}
```

**Output:** `{ inserted: number, skipped: number }`

Server-side dedup: `INSERT INTO brief_messages (...) ON CONFLICT (gmail_message_id) DO NOTHING`.

### `set-brief-intent`

Updates a brief with its classified intent type and stores the output (draft reply or scope fields).

**Input schema:**
```typescript
{
  brief_id: string,
  intent_type: 'new_brief' | 'project_thread' | 'retainer_thread' | 'general_query' | 'quick_response',
  draft_reply?: string,       // populated for quick_response only
  scope?: {
    enhanced_prose: string,
    in_scope_md: string,
    out_of_scope_md: string,
    open_questions_md: string,
    scope_type: 'new_brief' | 'project_thread' | 'retainer_thread' | 'general_query',
  }
}
```

**Output:** `{ updated: true }`

Implementation: updates `briefs.intent_type` and `briefs.draft_reply`; inserts/upserts a row into `scopes` if `scope` is provided.

---

## Intent types

Locked from Auto-Scope Architectural Decisions D2:

| Intent | Condition | Claude output |
|---|---|---|
| `quick_response` | Logistics, acknowledgement, scheduling — no deliverable | Draft reply stored in `briefs.draft_reply` |
| `new_brief` | New work, no existing project/retainer match | Full scope draft: enhanced prose + in/out scope + open questions |
| `project_thread` | References an active project | Change-request scope against existing project |
| `retainer_thread` | Within a retainer engagement | Retainer coverage check + what's covered vs over-scope |
| `general_query` | Advisory or planning question, no deliverable | Research summary + response notes |

### `quick_response` pre-filter

Before any classification inference, a cheap keyword check runs against the message body:
- Signals: reschedule, "got it", "thanks", "received", "noted", "confirmed", "when are you available", "can we push", "following up"
- Rules stored in `wiki/config/quick-response-rules.md` in cc-vault — editable without a code change
- If matched: skip classification inference, go straight to draft reply generation

---

## Per-run algorithm

```
1. SCAN
   Gmail search: label:"→Inbox/Push" OR label:"→Inbox/Push-Sent"
   Cap: 20 threads per run (volume is 20-50/month; cap prevents runaway on backlog)

2. FOR EACH THREAD:

   a. CHECK DUPLICATE
      check-duplicate-brief(gmail_thread_id)
      → brief_id if already exists, null if new

   b. FIND CLIENT
      find-client(sender email domain OR name)
      → { client_id, name, wiki_path } or null

   c. READ WIKI CONTEXT (if client found)
      cc-vault: read wiki/clients/<slug>/ folder
      → awareness of active projects, retainer, team contact, service scope

   d. CREATE BRIEF (idempotent)
      create-brief(gmail_thread_id, subject, body, sender_email, client_id?)
      → brief_id (existing or new)

   e. SYNC MESSAGES
      Fetch all messages from thread via Gmail MCP
      Classify direction per message (from_email == team email → outbound)
      sync-messages(brief_id, all_messages)
      → { inserted: N, skipped: M }

   f. CLASSIFY INTENT
      Only run if: inserted > 0 AND at least one new message is inbound.
      (New outbound-only messages update the thread record but don't trigger reclassification.)
      Only classify once per brief — skip if brief already has an intent_type set.

      Run quick_response pre-filter against the latest new inbound message body.
      If matched → intent = quick_response.
      Else → classify using wiki context + message content:
        - Wiki context contains an active retainer note for this client? → retainer_thread
        - Message body references a named active project from the wiki? → project_thread
        - Message is a question / request for advice with no deliverable? → general_query
        - Otherwise → new_brief

   g. GENERATE OUTPUT (only if new inbound messages were inserted and intent not yet set)
      quick_response → draft reply (concise, professional, from Brendan's voice)
      new_brief      → enhanced_prose + in_scope_md + out_of_scope_md + open_questions_md
      project_thread → change-request scope against active project context from wiki
      retainer_thread → retainer coverage check (covered vs over-scope)
      general_query  → topic summary + research notes + suggested response

   h. STORE RESULT
      set-brief-intent(brief_id, intent_type, draft_reply? | scope?)

3. REPORT
   "Scanned 8 threads. 2 new messages ingested:
    - Acme Co (jane@acme.co.za): quick_response — draft reply stored
    - Pebble (mike@pebble.co): new_brief — scope drafted
    6 threads had no new messages."
```

### When to skip classification

- `inserted == 0` for a thread: all messages already in Supabase. Skip steps f–h entirely. Thread stays labeled; next run checks again (safe).
- Client not found: create brief with no `client_id`, sync messages, skip classification. Log: "Unknown sender — brief created, no scope generated. Resolve client match manually."

---

## Gmail label behaviour

| Label | Applied by | Meaning | Removed? |
|---|---|---|---|
| `→Inbox/Push` | Teammate (inbound threads) | This thread is relevant — always monitored | Never removed |
| `→Inbox/Push-Sent` | Teammate (outbound threads) | This sent thread is relevant — always monitored | Never removed |

Labels stay on threads permanently. Dedup is handled by `brief_messages.gmail_message_id`, not by label removal. Re-labelling an already-ingested thread is safe — the skill skips already-processed messages silently.

---

## Skill file layout

```
~/.claude/skills/intake/
├── SKILL.md                          # main skill — routing, hard rules, algorithm
└── references/
    ├── intent-classification.md      # five intent types, pre-filter rules, output templates
    └── failure-modes.md              # per-type handling: unknown sender, MCP unavailable, etc.
```

### SKILL.md frontmatter

```yaml
---
name: intake
description: >
  Scans Gmail for threads labeled →Inbox/Push or →Inbox/Push-Sent, reads client
  wiki context, creates/updates briefs in cc-service-calculator via MCP, stores
  all messages (inbound + outbound), classifies intent, and generates scope or
  draft reply inline. Designed to run on /loop 5m or /loop 10m.
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
  mcp__cc-calculator__sync-messages
  mcp__cc-calculator__set-brief-intent
---
```

---

## Failure modes

| Condition | Action |
|---|---|
| Gmail MCP unavailable | Stop. Log: "Gmail MCP unreachable — skipping this tick." Do not error loudly on a loop. |
| cc-calculator MCP unavailable | Stop. Log the same. |
| Client not found | Create brief with no `client_id`. Sync messages. Skip classification. Log warning. |
| Thread has only outbound messages | Sync messages, skip classification (no inbound to classify). |
| Classification ambiguous | Default to `new_brief`. Log: "intent ambiguous, defaulted to new_brief." |
| `set-brief-intent` fails | Log the error. Brief and messages are already stored — only the intent/scope is missing. Do not retry in the same tick. |

---

## Hard rules

- ❌ Never delete or remove a Gmail label. Read-only on Gmail.
- ❌ Never send a Gmail reply. Draft replies are stored in the calculator for human review and send.
- ❌ Never touch ClickUp. That is Stage 6 (`/brief`).
- ❌ Never skip syncing messages even if the brief already exists. New replies need to be captured.
- ❌ Never block the loop on a single thread failure. Catch per-thread errors, log, continue.

---

## What this skill deliberately does NOT do

- Send emails (replies are stored as drafts only)
- Create ClickUp tasks (that is `/brief`, Stage 6)
- Write to the wiki
- Handle attachments (deferred — storage architecture not yet decided)
- Manage Gmail labels (read-only; labels are applied by teammates)
- Replace the Apps Script relay path (both can coexist; MCP path is the new primary)

---

## Out of scope for v1

- Attachment storage
- Auto-sending quick response drafts
- Rule management UI for quick-response pre-filter (wiki file is sufficient)
- Telegram / other intake channels
- Re-scoping on thread reply (scope fires once on first new inbound message per thread)

---

## Sequence diagram

```
/loop tick
    │
    ▼
Gmail MCP: search label:→Inbox/Push
    │
    ▼ (per thread)
cc-calculator: check-duplicate-brief
cc-calculator: find-client
cc-vault:      read wiki/clients/<slug>/
cc-calculator: create-brief          ← idempotent
cc-calculator: sync-messages         ← dedupes on gmail_message_id
    │
    │ inserted > 0?
    ▼
Classify intent (inline, using wiki context)
    │
    ▼
Generate output (draft reply OR scope)
    │
    ▼
cc-calculator: set-brief-intent
    │
    ▼
Log summary → next tick
```

---

## Dependencies

- cc-calculator MCP server must have `sync-messages` and `set-brief-intent` tools added
- `briefs` table needs `intent_type` and `draft_reply` columns (migration `0029` per auto-scope plan)
- `brief_messages` table must exist (migration `0023` per inbox-v2 plan)
- `scopes` table needs `scope_type` column (migration `0029`)
- `wiki/config/quick-response-rules.md` must exist in cc-vault
- Gmail label `→Inbox/Push` must exist in the Gmail account (teammates apply manually)
