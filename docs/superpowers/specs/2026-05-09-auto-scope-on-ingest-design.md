# Auto-Scope on Ingest — Design Spec
**Date:** 2026-05-09
**Status:** approved for implementation
**Repo:** cc-service-calculator

---

## Problem

Briefs arrive in the Inbox as raw email. The team currently has to manually click "Draft Scope" to trigger AI scoping. This means every brief sits unprocessed until someone notices it and initiates the work. The goal is to pre-scope and pre-classify every brief at the moment it lands — so the team opens the Inbox to find briefs that are already understood, just needing a human to tailor and act.

---

## Approach

**Approach C — fire-and-forget from `gmail-relay` to a new `auto-scope` Edge Function.**

`gmail-relay` stays fast and returns 200 to Apps Script immediately after storing the brief. After the new brief insert, it fires a background `fetch()` to `auto-scope` using `EdgeRuntime.waitUntil()`. `auto-scope` handles all classification and scoping work independently. Any failure in `auto-scope` is logged and swallowed — the brief always exists in the Inbox regardless.

---

## Classification Types

Every new brief is classified into one of five `intent_type` values:

| Type | Description | Output |
|---|---|---|
| `new_brief` | New work with no existing project/retainer context | Full scope draft |
| `project_thread` | References an active client project | Change-request scope |
| `retainer_thread` | Relates to a retainer engagement | Retainer coverage check |
| `general_query` | Advisory or planning question, no deliverable | Research + response notes |
| `quick_response` | Simple logistics email, reply needed, no scope | Draft reply only |

---

## Quick-Response Rules

Before Claude runs, a rule-based pre-filter checks whether the email qualifies as `quick_response`. Rules live in:

```
wiki/config/quick-response-rules.md
```

This file is read at runtime via the existing `loadClientWikiContext` GitHub helper. It is a plain markdown list — new rules can be added without touching code. Initial rules:

- Subject contains: "reschedule", "rescheduling", "change of meeting", "move our call"
- Subject contains: "received", "just checking in", "following up" (with body < 80 words)
- Body contains only a greeting + one sentence (no attachments, no line items)

If a rule matches, `auto-scope` skips both Claude calls and generates the draft reply directly.

---

## Data Model Changes

### `briefs` table — two new columns

```sql
ALTER TABLE briefs
  ADD COLUMN intent_type text
    CHECK (intent_type IN ('new_brief','project_thread','retainer_thread','general_query','quick_response')),
  ADD COLUMN draft_reply text;
```

- `intent_type` — set by `auto-scope` after classification. Null until auto-scope completes (UI shows "pending" state).
- `draft_reply` — populated only for `quick_response`. Displayed as a highlighted draft box in the conversation pane.

### `scopes` table — one new column

```sql
ALTER TABLE scopes
  ADD COLUMN scope_type text
    CHECK (scope_type IN ('new_brief','project_thread','retainer_thread','general_query'));
```

Labels the scope so the UI can render the correct template per type.

---

## New Edge Function: `auto-scope`

**File:** `supabase/functions/auto-scope/index.ts`
**Auth:** service role (called internally, not from browser)
**Request:** `POST { brief_id: string }`

### Internal flow

```
1. Load brief + client from DB
2. Load wiki context
     wiki/clients/<slug>/           ← client history, projects, retainers
     wiki/config/quick-response-rules.md  ← rule list
3. Rule pre-filter (no Claude call)
     Does email match any quick-response rule?
     YES → set intent_type = 'quick_response', skip Step 4 (classify), jump to Step 5
           (Step 5 still calls Claude to draft a contextual reply — only the classify
            call is skipped, not the reply generation)
4. Claude call 1 — CLASSIFY (~200 token output, cheap)
     Input:  email subject + body + client wiki context
     Output: { intent_type, reasoning }
5. Claude call 2 — SCOPE / RESPOND (prompt varies by intent_type)
     new_brief       → { enhanced_prose, in_scope[], out_of_scope[], open_questions[] }
     project_thread  → { change_request_summary, in_existing_scope, additions[], cost_note }
     retainer_thread → { retainer_summary, hours_note, covered_flag, over_scope_items[] }
     general_query   → { topic_summary, response_points[] }
     quick_response  → { draft_reply }
6. Write to DB
     UPDATE briefs SET intent_type, draft_reply (quick_response only), status = 'needs_review'
     UPSERT scopes (all except quick_response) with scope_type + scoped fields
```

### Prompts

**Classify prompt** — single call, JSON output only:
```
System: You are a digital agency intake classifier at Converted Click.
        Given an email and client context, classify the intent.
        Return JSON only: { "intent_type": "<type>", "reasoning": "<one sentence>" }
        Types: new_brief | project_thread | retainer_thread | general_query | quick_response
```

**Scope prompts** — one per intent_type, each requests JSON only. System block is shared/cached. User block varies by type.

### Error handling

- Wiki fetch failure → log warning, continue with empty context (best-effort, same as `draft-scope`)
- Classify call failure → log error, set `intent_type = null` (UI shows manual fallback)
- Scope call failure → log error, leave `scopes` row absent (manual "Draft Scope" button available)
- Any unhandled exception → logged, brief is unaffected in Inbox

---

## `gmail-relay` Change

Minimal. `Deno.serve` handler signature gains the `ctx` second argument. After the new brief insert (inside the `!existing` branch, before the aggregate refresh), add:

```typescript
const autoScopeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/auto-scope`;
ctx.waitUntil(
  fetch(autoScopeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({ brief_id: briefId }),
  }).catch((e) => console.error("[gmail-relay] auto-scope fire failed", e))
);
```

Thread replies (`existing` branch) are untouched — auto-scope fires on new brief creation only. Response shape and timing of `gmail-relay` are unchanged.

---

## UI Changes

### BriefRow (BriefList)

Add an `intent_type` badge next to the brief subject. Colour coding:

| Type | Label | Colour |
|---|---|---|
| `new_brief` | NEW | blue |
| `project_thread` | PROJECT | purple |
| `retainer_thread` | RETAINER | orange |
| `general_query` | QUERY | grey |
| `quick_response` | QUICK | green |
| `null` | pending... | muted/spinner |

### BriefConversation sheet

Three states based on `intent_type`:

**Null (auto-scope still running):**
- Show subtle "Scope pending..." spinner in the scope panel area
- Manual "Draft Scope" button visible as fallback

**`quick_response`:**
- No scope panel
- Highlighted draft box at top of conversation pane showing `draft_reply`
- "Copy draft" button

**All other types:**
- Existing scope panel renders, now labelled with scope type (e.g. "Change request" for `project_thread`)
- Manual "Draft Scope" button stays as refresh/override

---

## Wiki Config File

**File:** `wiki/config/quick-response-rules.md`
**Created:** as part of this implementation (provisioned manually or via a one-time script)

```markdown
---
type: config
title: Quick Response Rules
updated: 2026-05-09
---

# Quick Response Rules

Each rule below causes an email to be classified as `quick_response` automatically,
skipping full AI scoping. Add new rules as one bullet per line.

## Subject keyword rules
- reschedule
- rescheduling
- change of meeting
- move our call

## Short-body rules
- Body under 80 words AND subject contains: following up, just checking, received your
```

---

## Out of Scope (this spec)

- Re-scoping on thread reply (new messages on existing briefs do not trigger auto-scope)
- Telegram intake path (deferred, per original D1)
- Reply-from-app compose (deferred)
- Auto-sending quick responses (team still reviews and sends manually)
- Rule management UI in the calculator (wiki file is sufficient for now)

---

## Implementation order

1. Migration — add `intent_type`, `draft_reply` to `briefs`; `scope_type` to `scopes`
2. Create `wiki/config/quick-response-rules.md` in CC-Vault repo
3. New Edge Function `auto-scope` (classify + scope + write)
4. Extend `gmail-relay` with fire-and-forget call
5. UI — `intent_type` badge on BriefRow
6. UI — `BriefConversation` pending state + quick_response draft box + scope_type label
7. Deploy + smoke test end-to-end
