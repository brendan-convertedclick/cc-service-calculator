# Workflow / Process Builder — Design Spec

**Date:** 2026-05-09  
**Status:** Approved for implementation planning  
**Scope:** Process step instantiation per project, ClickUp-synced time tracking, handoff time measurement, bottleneck analytics

---

## Problem

The app has `process_steps` as a template layer per service (ordinal, title, department, estimated_hours) and `ProcessFlow.tsx` as the template editor. However:

1. No mechanism to instantiate those template steps onto a live project — `process_steps` is a definition, not a run.
2. `project_actuals` tracks time at the ClickUp task / department level, not at the individual step level.
3. There is no measurement of time *between* steps (handoff time) — the gap from one step's completion to the next step's start. This is where real bottlenecks live.
4. Only 2 of 139 seeded services have any process steps populated.

---

## What We're Building

A two-layer system:

- **Template layer** (already exists): `process_steps` per `service`. Defines the shape — ordinal, title, department, assignee, estimated hours.
- **Instance layer** (new): `process_step_instances` per `project`. A copy of the template steps, with live tracking: status, started_at, completed_at, actual_hours, ClickUp task ID.

From the instance layer we derive:
- Step execution time: `completed_at - started_at`
- Step variance: `actual_hours / estimated_hours`
- Handoff time: next step's `started_at - this step's completed_at`
- Bottleneck signals: steps and handoffs that consistently run long across multiple projects

---

## Source of Truth: Hybrid (ClickUp syncs, app overrides)

The team works in ClickUp as normal. The app syncs step status and time entries from ClickUp automatically. The ops manager can override any timestamp in the app if ClickUp data is wrong or missing — an audit trail distinguishes synced vs manual entries.

**ClickUp mapping**: when a project is created from an accepted quote, the existing `push-to-clickup` edge function creates one ClickUp task per `process_step_instance` (not just per service). This is a change from the current one-task-per-service model — it applies to new projects only. Existing projects retain their current ClickUp task structure and are tracked at department level via `project_actuals` as before. The `clickup_task_id` is stored on the instance. Status changes and time entries in ClickUp are pulled by the existing `sync-clickup-actuals` edge function — extended to write to `process_step_instances` in addition to `project_actuals`.

---

## Data Model

### New table: `process_step_instances`

```sql
create table process_step_instances (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  template_step_id    uuid references process_steps(id),  -- null if ad-hoc step added to project
  service_id          uuid references services(id),        -- denormalised for querying
  ordinal             int  not null,
  title               text not null,
  description         text,
  department_id       uuid references departments(id),
  assignee_id         uuid references team_members(id),
  estimated_hours     numeric(6,2),
  actual_hours        numeric(6,2) not null default 0,
  status              text not null default 'pending'
                      check (status in ('pending','in_progress','blocked','done','skipped')),
  blocked_reason      text,
  is_overridden       boolean not null default false,  -- true = diverged from template
  clickup_task_id     text,
  due_at              timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  -- sync metadata
  last_synced_at      timestamptz,
  manual_override     boolean not null default false,  -- true = ops manager overrode ClickUp data
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Derived view: handoff times between consecutive steps
create view process_step_handoffs as
select
  a.project_id,
  a.id                                      as from_step_id,
  b.id                                      as to_step_id,
  a.title                                   as from_title,
  b.title                                   as to_title,
  a.completed_at                            as from_completed_at,
  b.started_at                              as to_started_at,
  extract(epoch from (b.started_at - a.completed_at)) / 3600.0
                                            as handoff_hours
from process_step_instances a
join process_step_instances b
  on  b.project_id = a.project_id
  and b.ordinal    = a.ordinal + 1
where a.completed_at is not null
  and b.started_at    is not null;
```

### Auto-instantiation on project creation

When `push-to-clickup` fires (quote accepted → project created):
1. Query `process_steps` for all services on the quote
2. Insert one `process_step_instance` per step with `template_step_id`, `estimated_hours`, `department_id` copied from template
3. Create one ClickUp task per instance; store returned `clickup_task_id`

### Sync extension

The existing `sync-clickup-actuals` edge function is extended to:
1. For each `process_step_instance` with a `clickup_task_id`, fetch task status and time entries
2. Write `started_at`, `completed_at`, `actual_hours`, `status` to the instance
3. Set `last_synced_at` and `manual_override = false`
4. Skip any instance where `manual_override = true` (preserve ops manager's override)

---

## UI

### New "Workflow" tab in `ProjectScopeView`

Added alongside existing tabs: Inbox · Brief · Activity · Tasks · Quote/SOW · Time · **Workflow**

**Layout: two-column**

```
[Summary panel — left 240px] [Horizontal timeline — right, fills remaining width]
```

#### Summary panel (left)

Four stacked cards:
1. **Progress** — "3 of 6 steps" + gradient progress bar + current step label
2. **Execution time** — Estimated / Actual / Variance (colour-coded amber/red)
3. **Handoff time** — Total + breakdown per gap (colour-coded green/red by duration)
4. **Calendar time** — Working / Waiting + stacked bar + "X% of elapsed time is waiting"

#### Horizontal timeline (right)

- Equal-width step blocks in a horizontal row
- Each block shows: status badge, step name, assignee, actual vs estimated hours
- Block border/background colour = step health:
  - Green border = completed within estimate
  - Amber border = completed 10–20% over
  - Red border = completed 20%+ over
  - Indigo border = in progress
  - Dashed border = pending / skipped
- Connectors between blocks:
  - Fixed visual width (same for all connectors)
  - Label: actual handoff duration
  - Colour: green (< 4h), amber (4h–1d), red (> 1d)
- Pending steps: muted, dashed border, 40% opacity
- "Sync now" button top-right; last synced timestamp
- Ops manager can click any block → drawer with full step detail (timestamps, time entries, override controls)

---

## Template population (prerequisite)

The workflow builder is only useful if templates exist. Immediately after the schema migration:

1. Run the existing AI generation endpoint in bulk for the top 15 services (the most-delivered service types based on quote frequency)
2. These 15 populated templates become the initial library; others can be filled on demand

The existing `ProcessFlow.tsx` editor is unchanged — it remains the template editor on the service detail page.

---

## Analytics (Phase 2 — after instance data accumulates)

### Service accuracy report (`/services/:id` → Accuracy tab)

Per service, once 5+ project instances have completed:
- Table: step title, mean estimated hours, mean actual hours, accuracy ratio, sample count
- Highlight: steps where `actual/estimated > 1.2` consistently
- "Update template estimate" button → pre-fills the template `estimated_hours` with the p50 actual, pending AM approval

### Bottleneck heatmap (`/projects` → Insights tab, or dedicated `/analytics`)

- Rows: template steps (across all services)
- Columns: calendar months
- Cell colour: average `actual/estimated` ratio that month
- Reveals whether bottlenecks are improving over time or seasonal

### Project health signal (Dashboard `OpsOverview`)

Extend the existing `needs_attention` / `overdue` logic:
- Flag a project when any `process_step_instance` has `actual_hours > estimated_hours * 1.3` or has been `in_progress` for more than 2× its estimated duration
- Surface the specific step name in the `attentionProjects` list reason string

---

## Key files to modify

| File | Change |
|---|---|
| `supabase/migrations/` | New migration: `process_step_instances` table + `process_step_handoffs` view |
| `supabase/functions/push-to-clickup/` | Auto-instantiate steps on project creation |
| `supabase/functions/sync-clickup-actuals/` | Extend sync to write step instance timestamps + hours |
| `src/pages/ProjectScopeView.tsx` | Add "Workflow" tab |
| `src/components/WorkflowTimeline.tsx` | New component: horizontal timeline + summary panel |
| `src/hooks/useWorkflowSteps.ts` | New hook: query + mutate `process_step_instances` |
| `src/types/db.ts` | Add `ProcessStepInstance` type after migration |

---

## Out of Scope for V1

- Step dependencies / parallel tracks (steps are strictly sequential by ordinal)
- Client-visible workflow progress view
- Per-step comment thread
- Automated bottleneck alerts (Slack/email) — dashboard surface only
- Historical accuracy report (requires data accumulation before building)

---

## Open Questions (resolved)

- **Source of truth for step status?** ClickUp syncs; app can override. Hybrid.
- **One ClickUp task per step or per service?** One per step instance. This is a change from the current one-task-per-service model.
- **What if a project has no process steps on its services?** The Workflow tab shows an empty state with a "Generate steps with AI" CTA linking to the service's ProcessFlow editor.
- **Step-level vs dept-level actuals** — both exist. `project_actuals` (dept level, for BurnChart) is unchanged. `process_step_instances` adds the step-level layer on top.
