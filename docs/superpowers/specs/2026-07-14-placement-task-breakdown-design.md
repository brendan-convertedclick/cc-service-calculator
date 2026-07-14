# Per-Quote-Item Task Breakdown (Stage ③) — Design

**Date:** 2026-07-14
**Route affected:** `/briefs/:id/scope`

## Problem

Each billable quote line (a `brief_task_sow_placements` row in the Scope Receipt)
carries only a name, quantity, and one `estimated_cents`. To schedule work in
ClickUp we need, *per quote line*, a breakdown of tasks — each with a department,
a time allocation, and sprint points. Intake will eventually generate this; the
ops manager reviews and edits it; it becomes the source for ClickUp scheduling.

## Scope of this build

Model + ops-review UI + seeded demo data. **Out of scope (follow-ups):** intake
auto-generation, and the ClickUp scheduling push.

## Data model — new table `placement_tasks`

One row per task under a billable quote line. No RLS (mirrors its parent
`brief_task_sow_placements`, which has none — internal single-login app).

| column | type | notes |
|--------|------|-------|
| `id` | uuid PK | |
| `brief_id` | uuid → briefs (cascade) | denormalised for fetch |
| `placement_id` | uuid → brief_task_sow_placements (cascade) | the quote item |
| `title` | text | task name |
| `department_id` | uuid → departments (null) | the one dept that does it |
| `hours` | numeric(6,2) | time allocation |
| `points` | numeric(7,2) | sprint points |
| `points_overridden` | bool | true once ops edits points directly → stops auto-reseed |
| `sort_order` | int | ordering within a placement |
| `ai_generated` | bool | generated vs hand-added (for the future intake stage) |
| `created_at/updated_at` | timestamptz | trigger-maintained |

Queried untyped via `supabase as unknown as SupabaseClient` (same pattern as
`useScopeMap` — the table isn't in the generated db.ts types).

## Flow placement & gating

Stepper becomes **4 stages**: ① In/Out of Scope → ② The Brief →
**③ Task Breakdown** → ④ Scope Edit.

- Stage ③ unlocks when the brief is approved (same gate as Scope Edit).
- Stage ③ and ④ are both reachable after approval — plan tasks / edit scope in
  either order. Non-blocking.
- Stage ③ is **Done** (derived) when every billable line has ≥1 task with a
  department assigned. No extra gate column.
- Back-nav: ③ → ②, ④ → ③.

## UI — Stage ③ body (`TaskBreakdownStage`)

Accordion per billable ("New billable — quote") placement:
- **Header:** item name + rollup — `3 tasks · 13.0h · 52pt`.
- **Body:** a row per task — `title` (text) · `department` (select) · `hours`
  (inline number) · `points` (inline number) · delete. Plus **+ Add task**.
- **Hours ↔ points:** points auto-seed from hours (`× 4`, 1pt = 15min). Editing
  points sets `points_overridden` and decouples; a ↺ re-links to hours.
- **Grand total** (hours + points) across all items at the bottom.

Only `new_billable` placements get a breakdown this build (included/retainer
lines are future).

## Hooks

- `useLineTasks(briefId)` — all tasks for the brief, grouped by placement.
- `useAddLineTask` / `useUpdateLineTask` / `useDeleteLineTask` — optimistic,
  mirroring the placement mutations.

## Demo data

Seed a realistic breakdown for the 3 billable demo placements of brief
`910c03f5-…` so the ops-review UX is visible without intake generation.
