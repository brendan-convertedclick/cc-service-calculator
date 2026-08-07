# Systems — visual process mapping with ClickUp materialisation

**Date:** 2026-08-05 · **Status:** approved, ready for planning
**Scope:** Untether processes from services, consolidate the three divergent
ClickUp step renderings, add goals + revisions, and build a lane-free
drag-and-drop canvas on React Flow.

---

## How to use this document

This is a **design spec**, not an implementation guide. It locks decisions so they
don't get re-derived. The first job of any implementation workflow is to read this
plus the visual references below and produce a plan in
`docs/superpowers/plans/2026-08-05-systems.md`, then execute that plan via worktree
subagents per `CLAUDE.md`.

**Visual references — treat as the source of truth for UI:**

| File | Role |
|---|---|
| `docs/2026-08-05-systems-canvas-visual-spec.html` | **Authoritative canvas design.** Block anatomy, department colour spine, avatar, hours pill, handoff connector styling, unassigned-block treatment, inspector fields, department rollup strip. Build Phase 6 to match this. |
| `docs/2026-08-05-systems-clickup-triage.html` | Why steps must stay ClickUp tasks; the nesting → task+checklist mapping; the four destinations. Background for Phases 1–3. |
| `docs/2026-08-05-systems-concepts.html` | The five explored concepts and the comparison matrix. Historical context; concept 02 (lane-free) was selected. |

---

## Problem

Conductor documents *services* well and *systems* not at all. Three consequences:

1. **Sales and marketing were never defined as systems.** They have no
   documented process, so nothing happens by design — only by memory.
2. **Scoping is inaccurate** because the documented process and the estimate are
   maintained separately, and neither is checked against actuals.
3. **Work misses the standard** because there is no versioned, owned, goal-bearing
   definition of "done" that staff can be held to or contribute to.

Underneath that sit three concrete code problems discovered during triage:

- `push-to-clickup:610-638` creates one ClickUp subtask per process step but sends
  **no assignee, no `time_estimate`, no due date, no points** — the
  `estimated_hours` and `department_id` computed per step are discarded at the API
  boundary. Meanwhile `schedule-brief-tasks:151-298` renders the *same*
  `process_steps` data as a fully-specified task via `buildBriefTaskBody`.
- `services.checklist_items text[]` (migration 0102) is a free-text textarea that
  generates a real ClickUp checklist on the *service × department* task, with **zero
  linkage to `process_steps`**. Two competing "list of things to do" concepts on the
  same service, free to disagree.
- `push-to-clickup` has **no per-service or per-step skip condition** — everything
  on a quote is pushed unconditionally.

---

## Decisions (locked — do not re-litigate during implementation)

1. **Steps stay ClickUp tasks. Never checklist items.** ClickUp checklist items
   carry no `time_spent`, no `start_date`, no `date_closed`, and collapse status to
   a boolean. `sync-clickup-actuals:230-289` resolves instances via
   `GET /api/v2/task/{id}`, which does not accept checklist-item ids. Moving steps
   to checklist items would permanently zero `actual_hours`, kill
   `process_step_handoffs`, and destroy est-vs-actual. **This is the single most
   important constraint in this spec.**
2. **Two depths, not two options.** A top-level step → a ClickUp task. Its
   sub-steps → checklist items *on that task*. This absorbs
   `services.checklist_items`, which is then deprecated.
3. **Per-step materialisation, not per-process.** `materialise_as` is an enum on the
   step, not a boolean on the system. Not every documented step deserves a task.
4. **Four system kinds, not two types:** `service`, `recurring`, `internal`,
   `reference`. Only `reference` is genuinely new behaviour.
5. **Internal systems reuse `ongoing_tasks`.** Sales/marketing/admin systems map to
   an existing `time_categories` row and attribute time to the perpetual
   `[Internal] {member} — {category}` ClickUp task that `provision-ongoing-tasks`
   already creates. **No new ClickUp tasks are created for internal systems.**
6. **Goal is mandatory.** `system_definitions.goal_statement` is `not null`. A
   system without a goal cannot be created.
7. **Revisions gate publication.** Because publishing a system now changes what
   appears in someone's ClickUp task list, publication requires approval. Revisions
   affect **future materialisation only** — existing `process_step_instances` are
   immutable snapshots and are never rewritten.
8. **Canvas is lane-free.** Department is a colour on the block (from the existing
   `departments.color`), person is an avatar. Handoffs render on the *connector*
   when `department_id` differs across an edge. No swimlane group nodes.
9. **Canvas library: `@xyflow/react` v12 (MIT) + `dagre`.** Not tldraw (now
   commercially licensed).
10. **Sub-steps carry no hours.** Only top-level steps have `estimated_hours`. This
    keeps `service_allocation_resolved` correct without changing its arithmetic.
11. **Naming — "Systems" is user-facing; `process_steps` keeps its name.** Nav label
    "Systems", route `/systems`, new tables prefixed `system_`. The **existing**
    `process_steps` and `process_step_instances` tables are **not renamed** — doing so
    would touch `service_allocation_resolved`, `push-to-clickup`,
    `sync-clickup-actuals`, `schedule-brief-tasks`, `analyze-brief-sow`,
    `ProcessFlow.tsx`, `useProcessSteps.ts`, `useWorkflowSteps.ts`,
    `WorkflowTimeline.tsx` and generated `db.ts` for zero user benefit. A system
    *has* process steps; that reads fine. Do not "tidy" this up.

---

## Explicitly rejected

- Steps as ClickUp checklist items (see Decision 1).
- Swimlane containers on the canvas.
- A `can_action_in_clickup` boolean on the system.
- Any new provisioning mechanism for internal systems — `ongoing_tasks` already exists.
- Renaming `process_steps` / `process_step_instances` (see Decision 11).
- Two-way live sync of canvas blocks against ClickUp actuals (V2; see Out of scope).

---

## Vocabulary

| Term | Meaning | Where it lives |
|---|---|---|
| **System** | A named, owned, goal-bearing way of doing something. The top-level object. | `system_definitions` |
| **Step** | One unit of work within a system. Materialises as a ClickUp task. | `process_steps` (existing, `parent_id is null`) |
| **Sub-step** | Detail within a step. Materialises as a checklist item. | `process_steps` with `parent_id` set |
| **Canvas** | The drag-and-drop *view* of a system. Not the product name. | `src/components/systems/` |
| **Revision** | An immutable published version of a system. | `system_revisions` |

---

## Phase dependency graph

```
P1 (task payload)  ─┐
P2 (nested steps)  ─┼─→ P3 (kinds + materialise) ─→ P4 (systems + goals) ─→ P5 (revisions) ─→ P6 (canvas)
                    │
P1 and P2 are independent of each other and may run in parallel worktrees.
P3 onwards are strictly sequential.
```

---

## Phase 1 — Fix the anaemic step tasks

**No schema change. No canvas dependency. Ship independently.**

`push-to-clickup/index.ts:610-638` currently POSTs:

```ts
{ name: `[Step ${instance.ordinal}] ${instance.title}`, parent: parent.id, ...sharedCustomFields }
```

Replace with a call to the existing shared builder `buildBriefTaskBody`
(`supabase/functions/_shared/clickup.ts:141-198`) so step tasks carry the same
fidelity as brief placement tasks:

- `assignees` — from `process_steps.owner_id` → `team_members.clickup_user_id`; fall
  back to `departments.primary_team_member_id`; omit if neither resolves.
- `time_estimate` — `estimated_hours * 3_600_000` ms.
- `points` — `Math.min(10, Math.max(1, Math.round(estimated_hours / 4)))`, matching
  the service×department child at L371-391. Retain the existing points-cap retry
  behaviour from `schedule-brief-tasks:265-268` (re-POST without `points` on 400).
- `description` — `process_steps.description`.
- `due_date` / `start_date` — inherit the project's `due_date` logic already used at
  L380-386. Omit if the project has no due date.
- Work Stream custom field — from `departments.clickup_work_stream` (migration 0066),
  falling back to `services.clickup_work_stream` (0067).

Keep step-task creation **best-effort** (existing `try/catch`, non-fatal) — a failed
step task must not abort the push, unlike the service×department child.

**Acceptance:** push a quote with a service that has populated `process_steps`;
every `[Step N]` task in ClickUp has an assignee, a time estimate matching
`estimated_hours`, and points. `process_step_instances.clickup_task_id` is populated
for each.

---

## Phase 2 — Nested steps absorb `checklist_items`

### Migration (next sequential number, ≈0103)

```sql
alter table process_steps
  add column parent_id uuid references process_steps(id) on delete cascade;

create index process_steps_parent_idx on process_steps(parent_id);

-- the existing unique(service_id, ordinal) cannot survive nesting.
alter table process_steps drop constraint if exists process_steps_service_id_ordinal_key;
create unique index process_steps_ordinal_idx
  on process_steps (coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    coalesce(parent_id,  '00000000-0000-0000-0000-000000000000'::uuid),
                    ordinal);

-- sub-steps carry no hours; enforce it
alter table process_steps
  add constraint process_steps_substep_no_hours
  check (parent_id is null or estimated_hours is null);
```

**`service_allocation_resolved` must be recreated** with `where parent_id is null` on
its `process_steps` scan. Sub-steps have null hours so the sum is already correct,
but the filter is defensive and makes intent explicit. The 99.5–100.5 tolerance
trigger on `rule_allocations` is untouched.

`ProcessFlow.tsx` performs a three-stage ordinal swap (L108-113) to dodge the old
unique constraint — verify it still works against the new partial index, and scope
its swaps to siblings sharing the same `parent_id`.

### Data migration

For every `services.checklist_items` entry, create a sub-step under the service's
**last** top-level `process_step` (arbitrary but deterministic; operators will
re-parent on the canvas). Preserve array order as `ordinal`. Then mark
`services.checklist_items` deprecated in a comment — **do not drop the column in this
phase**; `provision-retainer-period:488-491` and `create-quick-brief-task:152-153`
still read `retainer_recurring_services.checklist_items` and ad-hoc items
respectively, which are out of scope here.

### ClickUp change

In `push-to-clickup`, after creating a step task, call the existing
`addClickupChecklist` (`_shared/clickup.ts:241-273`) with that step's sub-step titles.
Remove the `checklistMap` call at L404-405 that stamps `services.checklist_items` onto
the service×department task — that behaviour is now served by the step hierarchy.

**Acceptance:** a service with 3 top-level steps and 4 sub-steps under step 3
produces 3 ClickUp subtasks, with a 4-item checklist on the third. Allocation
percentages on `/services/:id` are unchanged from before the migration.

---

## Phase 3 — Kinds and materialisation modes

### Migration

```sql
create type system_kind      as enum ('service','recurring','internal','reference');
create type materialise_mode as enum ('task','checklist_item','none');

alter table process_steps
  add column materialise_as materialise_mode not null default 'task';
```

### Semantics

| Step | `materialise_as` | ClickUp artefact |
|---|---|---|
| Top-level | `task` | Subtask under the project parent; sub-steps become its checklist |
| Top-level | `checklist_item` | Checklist item on the service × department task |
| Top-level | `none` | Nothing |
| Sub-step | *(ignored)* | Always a checklist item on its parent's task; if the parent is not `task`, the sub-step rolls up as a sibling checklist item on the service × department task |

### Skip condition

`push-to-clickup` gains its first per-step skip: steps with `materialise_as = 'none'`
are still inserted into `process_step_instances` (so the workflow timeline stays
complete) but no ClickUp task is created and `clickup_task_id` stays null.
`sync-clickup-actuals:236` already filters `.not("clickup_task_id","is",null)`, so
these instances are correctly ignored by sync with no change needed there.

**Acceptance:** setting a step to `none` removes its ClickUp task on the next push
while leaving the step visible in the Workflow tab with `actual_hours = 0`.

---

## Phase 4 — Systems: untether from services

### Migration

```sql
create table system_definitions (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  kind             system_kind not null,
  goal_statement   text not null,          -- mandatory. no system without a goal.
  goal_metric      text,
  owner_id         uuid references team_members(id),
  expert_id        uuid references team_members(id),
  service_id       uuid references services(id),                        -- kind='service'
  recurring_service_id uuid references retainer_recurring_services(id), -- kind='recurring'
  time_category_id uuid references time_categories(id),                 -- kind='internal'
  band             text,   -- attract | convert | deliver | retain | internal
  trigger_text     text,
  definition_of_done text,
  exceptions_md    text,
  review_due_at    date,
  current_revision_id uuid,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint system_def_kind_link check (
    (kind = 'service'   and service_id is not null)           or
    (kind = 'recurring' and recurring_service_id is not null) or
    (kind = 'internal'  and time_category_id is not null)     or
    (kind = 'reference')
  )
);

alter table process_steps
  alter column service_id drop not null,
  add column system_id uuid references system_definitions(id) on delete cascade,
  add column goal_statement text,
  add column definition_of_done text,
  add column owner_id uuid references team_members(id);

create index process_steps_system_idx on process_steps(system_id);
```

Attach the standard `trg_<table>_touch` trigger using `public.tg_touch_updated_at()`
(`0001_init.sql:103`). RLS: follow the newer pattern —
`current_team_member_role() in ('admin','owner')` for write,
authenticated read for all (`0061_scope_map.sql:46`).

### Backfill

For every distinct `service_id` in `process_steps`, create a `system_definitions`
row with `kind='service'`, `service_id`, `name = services.name`, and
`goal_statement = 'TODO: set a goal for this system'` (the not-null constraint must
be satisfied; the list surfaces these as unmapped). Set `system_id` on the existing
steps.

### Internal systems and time attribution

For `kind='internal'`, **no ClickUp tasks are created.** The system defines the
shape of the work; time is already collected by the perpetual
`[Internal] {member} — {category}` task that `provision-ongoing-tasks:263-281`
creates per `(team_member_id, time_category_id)`. The system detail page reads
`ongoing_actuals_current` joined via `ongoing_tasks.time_category_id` to show
"this system consumed 14.2h last month" against the sum of its step estimates.

### Routes and nav

- `/systems` — list of `system_definitions`, grouped by `band`, with an
  "unmapped / no goal" filter.
- `/systems/:id` — system detail: goal, owner, steps, revision history, and the
  canvas (Phase 6).
- Nav label **"Systems"**. Add to `src/components/nav/navItems.ts` via
  `navEntriesFor(role)`. Visible to `admin` and `owner`; `staff` are bounced to
  `/staff` by existing `RequireRole` gating, so a staff-facing read-only view is a
  later phase, not this one.

**Acceptance:** a `kind='internal'` system named "Sales System" can be created,
linked to the `sales-bd` time category, given steps with hours, and shows actual
overhead hours from `ongoing_actuals` against its estimate — with zero new ClickUp
tasks created.

---

## Phase 5 — Revisions and the publication gate

### Migration

```sql
create table system_revisions (
  id                uuid primary key default gen_random_uuid(),
  system_id         uuid not null references system_definitions(id) on delete cascade,
  revision          int  not null,
  body              jsonb not null,       -- full snapshot of steps at publish time
  schema_version    int  not null default 1,
  state             text not null check (state in ('draft','proposed','published','superseded')),
  reason_for_change text not null,
  proposed_by       uuid references team_members(id),
  proposed_at       timestamptz,
  approved_by       uuid references team_members(id),
  approved_at       timestamptz,
  effective_date    date,
  supersedes_id     uuid references system_revisions(id),
  diff_summary      jsonb,                -- {added:[],removed:[],changed:[]}
  created_at        timestamptz not null default now(),
  unique (system_id, revision)
);

-- exactly one live published revision per system.
-- mirrors quotes_one_live_per_scope_idx from 0006.
create unique index system_revisions_one_live_idx
  on system_revisions (system_id) where state = 'published';
```

### State machine

`draft` → `proposed` → `published` (or back to `draft` on "request changes").
Publishing sets the prior `published` row to `superseded` in the same transaction and
updates `system_definitions.current_revision_id`.

Reuse the approval shape already established by `extension_requests` (0053) and
`revision_requests` (0095): proposer is any `team_members` row; approver must be
`admin` or `owner` per `current_team_member_role()`.

`reason_for_change` is `not null` — the proposal form cannot submit without it.

### Materialisation rule

**Only `published` revisions materialise.** `push-to-clickup` and
`provision-retainer-period` read the steps belonging to the current published
revision. Draft edits never reach ClickUp. Existing `process_step_instances` are
never rewritten by a new revision — they are immutable snapshots of the system as it
stood when the project was created.

### Diff

`diff_summary` is computed on transition to `proposed` using `jsondiffpatch`
(~3KB gzipped, add as a dependency) against the current published `body`. Compare on
step `id`; classify as added / removed / changed, and for `changed` record which of
`title`, `estimated_hours`, `department_id`, `owner_id`, `materialise_as` moved.

UI for V1: a two-column before/after list with added (green), removed (red
strikethrough) and changed (amber) styling. **Graph-topology diffing is out of scope**
— compare the ordered step list only.

**Acceptance:** a staff member can open a proposal against a published system,
change a step's hours, submit with a reason, and an owner sees the diff and approves
it to rev N+1. The previous revision is `superseded`. ClickUp is unaffected until the
next project push.

---

## Phase 6 — The canvas

**Build to match `docs/2026-08-05-systems-canvas-visual-spec.html`.** That file is the
authoritative visual reference for block anatomy, colour usage, connector styling and
inspector layout.

### Dependencies

```
npm i @xyflow/react dagre
npm i -D @types/dagre
```

### Component structure

```
src/components/systems/
  SystemCanvas.tsx         — ReactFlowProvider, nodes/edges state, save
  SystemBlockNode.tsx      — custom node: title, goal, dept colour, avatar, hours
  SystemDecisionNode.tsx   — pill-shaped decision node
  HandoffEdge.tsx          — custom edge; amber + "⇄ Handoff" when dept differs
  BlockInspector.tsx       — right rail: title, goal, dept, owner, hours, materialise_as
  DeptRollup.tsx           — bottom strip: hours by department + total
  useAutoLayout.ts         — dagre wrapper for the "Tidy up" action
src/hooks/useSystemDefinition.ts
src/hooks/useProcessSteps.ts   — extend existing
```

### Visual rules

- **Department = colour.** Read `departments.color` (already exists, already used
  elsewhere). Render as a 5px left border on the block plus an uppercase department
  label. Do **not** invent a palette.
- **Person = avatar.** Initials circle from `team_members.full_name`.
- **Handoff = edge styling.** When `source.department_id is distinct from
  target.department_id`, the edge renders amber, dashed, labelled `⇄ Handoff`.
  Expose this as a view for later reuse:

```sql
create view system_handoffs as
select e.*, true as is_handoff
from system_edges e
join process_steps a on a.id = e.source_step_id
join process_steps b on b.id = e.target_step_id
where a.department_id is distinct from b.department_id;
```

- **Nesting** uses React Flow `parentId` for genuine sub-steps only (never for
  lanes). Double-clicking a block with sub-steps opens its nested canvas.
- **Unassigned blocks** (`department_id is null`) render red-dashed with a
  "nobody owns this" label — this is how gaps in sales/marketing surface visually.
- **Highlight by person** filter: clicking an avatar dims all blocks not owned by
  that person. This replaces the one genuine affordance lost by dropping lanes.
- Styling uses the `m-` M3 token classes and `shadow-elev-*` per `CLAUDE.md`. No
  hardcoded hex. Note `src/components/ui/` has only 20 shadcn primitives — there is
  no `form` or `dropdown-menu` wrapper; use what exists or a native control.

### Persistence

Edges need a home:

```sql
create table system_edges (
  id             uuid primary key default gen_random_uuid(),
  system_id      uuid not null references system_definitions(id) on delete cascade,
  source_step_id uuid not null references process_steps(id) on delete cascade,
  target_step_id uuid not null references process_steps(id) on delete cascade,
  label          text,
  created_at     timestamptz not null default now(),
  unique (source_step_id, target_step_id)
);

alter table process_steps
  add column pos_x int,
  add column pos_y int;
```

Positions persist on drag-end (debounced 800ms). Steps remain **normalised rows**,
not a JSON blob — this is what keeps `service_allocation_resolved` working and makes
Phase 5's diffing tractable.

**Acceptance:** drag a block onto the canvas, set its department, owner, hours and
`materialise_as`, connect it, reload the page and the graph is identical. The
department rollup strip sums correctly and matches `/services/:id` allocation for a
`kind='service'` system.

---

## Error handling

- **Step task creation fails in ClickUp** — already non-fatal; log and continue. The
  instance exists with a null `clickup_task_id` and is skipped by sync.
- **Checklist creation fails** — non-fatal. `addClickupChecklist` never persists ids
  and is not read back, so a failure is cosmetic.
- **System with no published revision** — `push-to-clickup` falls back to the raw
  `process_steps` rows for that system (so Phase 1–4 behaviour survives a system
  that predates Phase 5). Log a warning.
- **`kind='internal'` system reaching a materialisation path** — hard skip with a
  logged warning; internal systems must never create project tasks.
- **Backfilled systems with the placeholder goal** — surfaced in the `/systems`
  list under an "unmapped" filter; never block materialisation.
- **Orphaned edges** — `on delete cascade` from both step FKs; no manual cleanup.
- **Cycle in the graph** — permitted (loops are real in marketing systems). Dagre
  handles cycles; do not add a cycle check.

---

## Testing

- `_shared/clickup.test.ts` — extend for the step-task body built via
  `buildBriefTaskBody`: assignee resolution fallback chain, `time_estimate`
  conversion, points cap and retry.
- New `system-materialise.test.ts` — the `materialise_as` matrix from Phase 3:
  every combination of top-level/sub-step × task/checklist_item/none produces the
  expected ClickUp artefact set.
- New `system-diff.test.ts` — `diff_summary` classification: added, removed, and
  each changed-field case.
- SQL: assert `service_allocation_resolved` returns identical rows before and after
  the Phase 2 migration for a service with sub-steps (regression guard on the
  double-counting risk).
- Playwright (`e2e/`): create an internal system → add steps → propose a change →
  approve → verify rev 2 published and rev 1 superseded.
- Manual: push a quote for a service with nested steps and confirm the ClickUp
  subtask/checklist shape by eye before shipping Phase 2.

---

## Out of scope

- Two-way live sync of canvas blocks against ClickUp actuals (blocks show estimates
  and, for `kind='internal'`, aggregate `ongoing_actuals` — no per-block live status).
- The Atlas L0 business map (`/systems` list is sufficient for V1).
- Acknowledgement / read-receipt queue for published revisions.
- Staff-facing read-only system view at `/staff`.
- Graph-topology diffing (ordered step-list diff only).
- Dropping `services.checklist_items` or migrating
  `retainer_recurring_services.checklist_items`.
- Consolidating `schedule-brief-tasks` and `push-to-clickup` into one renderer —
  Phase 1 makes them consistent in payload, not in code path.
- `resolveListAlias` adoption (still unused in production; unchanged here).
- AI generation of steps for non-service systems — `generate-process-steps`
  currently requires a `service_id` and stays that way for V1.
