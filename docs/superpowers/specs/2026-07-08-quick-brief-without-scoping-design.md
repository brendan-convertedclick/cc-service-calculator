# Quick-Brief Without Scoping — Design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan
**Author:** Conductor / Brendan

## Problem

Every inbound brief today is funnelled through the full scope pipeline
(Inbox → Scope review + AM gate → SOW map → Quote → push-to-ClickUp). Most
requests don't need that. A large share are either:

- pure questions/status checks that need only a reply, or
- one concrete, self-evident deliverable a person can just do (pull a report,
  add a redirect, resize assets).

Running the heavy scope machine on these manufactures ceremony that isn't
warranted and slows the operator down. We want the operator to choose, at brief
arrival, **scope it or not** — with the AI pre-selecting the likely answer.

Today's real examples (2026-07-07 Trellidor briefs) illustrate all three cases:
"is it 1080×1350?" (reply only), "pull the discount report Jul–Mar + make it
monthly" (quick task), "build a landing page" (needs scope).

## Goals

- A three-way **handling** decision per brief: reply-only / quick-task /
  needs-scope, AI pre-classified with one-click operator override (hybrid).
- A **quick-task** path that creates a single ClickUp task directly — right
  assignee, custom fields, points, audit comment — with **no** scope, SOW, or
  quote step.
- A lightweight **confirm sheet** so the operator eyeballs the AI's
  assignee/estimate/due/work-stream before the task hits ClickUp (and the
  invoice).

## Non-Goals

- No change to the 🔴 needs-scope pipeline (Scope → SOW → Quote → push).
- No full `/scheduler` nearest-neighbour estimation for quick tasks — a
  lightweight AI point guess is enough.
- No new intent taxonomy beyond adding one value; `quick_response`
  (reply-only) stays as-is.
- No bulk/batch quick-briefing in V1 (one brief at a time).

## Handling Buckets

The bucket is carried by the existing `briefs.intent_type` text column:

| Bucket | intent_type | Outcome |
|--------|-------------|---------|
| 🟢 Reply only | `quick_response` (exists) | Draft reply, no ClickUp task |
| 🟡 Quick task | `quick_task` (**new**) | One ClickUp task, no scope |
| 🔴 Needs scope | `new_brief` / `project_thread` / `retainer_thread` | Full scope pipeline (unchanged) |
| Question | `general_query` (exists) | Usually reply-only |

**Classifier boundary rule (approved):**

- 🟢 **Reply only** — pure question / info request, no work to do.
  _e.g._ "Is it 1080×1350?", "what's the status?"
- 🟡 **Quick task** — one concrete, self-evident deliverable a person can just
  do, no estimation debate. _e.g._ "pull the discount report Jul–Mar", "add
  this redirect", "resize these 5 assets".
- 🔴 **Needs scope** — new/multi-step work where effort, price, or SOW-fit isn't
  obvious. _e.g._ "build us a landing page", "plan a campaign".

## Data Model Changes

All small; the 🔴 path tables (scopes, brief_intelligence,
brief_task_sow_placements, quotes) are untouched.

1. **`quick_task` intent value** — add to the allowed `briefs.intent_type`
   values. Column is `text`, so this is a check-constraint / documentation
   change, not an enum migration. Mirror the same allowance in `scopes.scope_type`
   only if a scopes row is otherwise required (it is **not** for quick tasks — no
   scopes row is created).
2. **`briefed` status** — add to `briefs.status`. Terminal state meaning "a
   quick task was created; no scope/quote". Sits alongside
   new / triaged / scoped / quoted / accepted / rejected / needs_info / spam /
   archived.
3. **Traceability columns on `briefs`** — `clickup_task_id text`,
   `clickup_task_url text` (nullable). Set when a quick task is created; mirrors
   the pattern already on `staff_briefs`.

## Flow

### 1. Classify (hybrid)

The existing `auto-scope` edge function
(`supabase/functions/auto-scope/index.ts`) already runs Claude to classify each
inbound brief and writes `intent_type`. Extend its `CLASSIFY_SYSTEM` prompt with
the 🟡 `quick_task` bucket and the boundary rule above. No new edge function; no
change to how/when classification is triggered.

### 2. Bucket-aware buttons

On the Inbox brief row (`src/components/BriefRow.tsx`) **and** inside the open
brief, surface the handling choice with the AI's pick pre-selected as primary:

- 🟡 `quick_task` → primary **"Brief as-is"**, secondary **"Scope it"**
- 🔴 needs-scope → primary **"Scope it"**, secondary **"Brief as-is"**
- 🟢 `quick_response` / `general_query` → primary **"Draft reply"**, secondary
  **"Scope it"**

Any secondary is one click to override. "Scope it" routes to today's flow
(`accept` → `/briefs/:id/scope`). This is the entire "scope or not" toggle.

### 3. "Brief as-is" → confirm sheet

Opens a small pre-filled, fully editable sheet:

| Field | Pre-fill source |
|-------|-----------------|
| Task name | Brief `raw_subject` |
| Assignee | AI picks from team roster by Work Stream; falls back to the operator (Brendan) if unsure |
| Estimate (sprint points) | Lightweight AI point guess (1 pt = 15 min) |
| Work Stream | Service/department the AI maps the ask to |
| Due date | AI reads urgency cues ("urgently", "by Friday"); else blank |

Operator confirms → **Create task**.

### 4. Create

A new thin edge function `create-quick-brief-task` reuses the single-task
creation path lifted from `approve-staff-brief`
(`supabase/functions/approve-staff-brief/index.ts`) via `_shared/clickup` +
`buildBriefComment`:

- Create one ClickUp task in the client's ClickUp list with the 4 custom fields
  (Client Name, Date of Engagement, Engagement Type = "Task", Work Stream) +
  sprint points.
- Post the `BRIEF::` audit comment.
- Set `briefs.status = 'briefed'`, store `clickup_task_id` / `clickup_task_url`.

No scopes row, no quote, no SOW placement.

## Edge Cases

- **Brief has no client** → confirm sheet blocks Create and prompts "assign
  client first" (Inbox already has client-assignment UI in `BriefRow`).
- **Client missing ClickUp folder/list** → clear error surfaced, no silent
  fail — the same guard `approve-staff-brief` uses (`clickup_folder_id`
  required).
- **Re-fire / double-click** → idempotent: if the brief already has a
  `clickup_task_id`, the edge fn no-ops and returns the existing task (mirrors
  `approve-staff-brief`'s re-approval guard).
- **AI misclassifies** → always recoverable via the visible secondary button;
  no bucket is a dead end.

## Components to Build vs Reuse

**Reuse:**
- `auto-scope` edge fn (extend prompt only)
- `approve-staff-brief` single-task creation logic → lifted into the new edge fn
- `_shared/clickup` helpers, `buildBriefComment`
- Inbox client-assignment UI in `BriefRow`

**Build:**
1. Migration: `quick_task` intent value + `briefed` status + 2 brief columns.
2. Classifier prompt extension in `auto-scope`.
3. New edge fn `create-quick-brief-task`.
4. Frontend: bucket-aware button group (inbox row + open brief); confirm-sheet
   component; wiring to the edge fn; status flip + optimistic list update.
5. A pure helper for the estimate/assignee/work-stream/due suggestions (so it's
   unit-testable independent of the LLM call — the LLM fills a structured object,
   the helper normalises/validates it).

## Testing

- **Classifier boundary** — table of representative asks → expected bucket
  (incl. the 🟡/🔴 edge cases), asserted against the extended prompt.
- **Suggestion helper** — pure unit tests: urgency parsing → due date, roster →
  assignee fallback, point-guess bounds (min 1).
- **Create path** — integration test with a mocked ClickUp: confirm →
  single task created with correct custom fields + points, `BRIEF::` comment
  posted, brief flips to `briefed`, task id/url stored.
- **Idempotency** — second Create on the same brief no-ops.
- **Guards** — no client / no ClickUp folder → blocked with the right message.

## Rollout

- Ship behind the existing ClickUp-enabled settings gate (`clickup_enabled`).
- The classifier change is additive: existing briefs keep their intent_type;
  only newly classified briefs can land in 🟡. Existing briefs can be manually
  moved to quick-task via the override button.
