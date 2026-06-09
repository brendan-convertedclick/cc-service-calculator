# Retainer hours consumed + sync — design

**Date:** 2026-06-09
**Status:** Approved (pending spec review)

## Problem

The Retainers list (`src/pages/RetainersList.tsx`) shows Client, Name, Monthly fee,
Hours target, Status. After creating a retainer and tracking time against its
auto-seeded ClickUp tasks, the operator has **no way to see hours consumed** and
**no way to pull** that tracked time into the app.

### Root-cause gap (why a naive sync button wouldn't work)

`provision-retainer-period` creates the ClickUp tasks for a retainer period and
records their IDs in `provisioned_tasks.clickup_task_ids` — but it never writes to
`project_actuals`. Meanwhile `sync-clickup-actuals` only re-syncs task IDs it finds
in `project_actuals_current` (the latest-snapshot-per-task view over `project_actuals`).

Net effect: **a retainer's provisioned-task time never enters the actuals/burn
pipeline.** A sync control that only calls the existing function would surface
nothing. This also means the Pulse `RetainerBurnSection` is silently empty for
retainers today, for the same reason.

## Goals

- Show **hours consumed this calendar month vs the hours target** per retainer, with
  a thin RAG burn bar (green → amber ≥70% → red ≥85%).
- Provide a **per-row sync icon** (sync one retainer) and a header **"Sync all"**.
- Make retainer provisioned-task time flow through the **existing** burn pipeline so
  the Pulse burn section starts working too — one source of truth.

## Non-goals (YAGNI)

- Per-person / per-service breakdown on the list.
- Historical burn-over-time chart (already exists in Pulse).
- Capacity/availability planning (out of scope for V1).
- Changing how non-retainer projects sync.

## Approach

**Chosen: A — extend `sync-clickup-actuals` to include `provisioned_tasks`.**
Rejected alternative B (a separate retainer-only ClickUp computation): duplicates the
burn path, leaves Pulse broken, and still needs a server function + caching.

### Backend — `supabase/functions/sync-clickup-actuals/index.ts`

For each project being synced, in addition to the task IDs gathered from
`project_actuals_current`:

1. Fetch `provisioned_tasks` rows for the project whose period covers today
   (`period_start <= today <= period_end`), collect `clickup_task_ids`.
2. **Union** those task IDs with the existing-actuals task IDs, deduped (a task
   already in `project_actuals_current` is not double-counted).
3. For each task ID not already carried forward, fetch ClickUp time entries (same
   call the function already makes), sum duration → `actual_hours`, and **insert** a
   fresh `project_actuals` row (append-only, same as today). For these
   newly-introduced provisioned tasks:
   - `planned_hours`: derived from the recurring service
     (`points_per_occurrence × 15min`, in hours); fall back to `0` if not resolvable.
     Note: burn does not use per-task `planned_hours` for retainers — it uses
     `projects.retainer_hours_target` — so this value is informational only.
   - `dept_id`: `null`.
   - `clickup_task_id`, `project_id`, `actual_hours`, `status_at_sync`,
     `time_entries`: as the function already sets them.
4. After first insert, these tasks appear in `project_actuals_current` and are
   carried forward by subsequent syncs with no special-casing.

`{ project_id }` force-sync and the no-body "sync all in-progress" path both pick up
this logic. Redeploy the function after the change (`verify_jwt = false` already set).

### Frontend — `src/pages/RetainersList.tsx`

- **Hours used column** (between Hours target and Status): reuse `usePulseRetainerBurn`
  (already returns `{ projectId, hoursUsed, hoursTarget, burnPct, rag }` per in-progress
  retainer for the current month). Build a `Map<projectId, burnRow>`. Render
  `{hoursUsed} / {target}h` plus a thin progress bar coloured by `rag`. Retainers
  absent from the burn map (no target, or not in-progress) render `—`.
  - Extract a small `HoursUsedCell` (or inline bar) — mirror the bar/RAG logic already
    in `RetainerBurnSection` rather than re-deriving thresholds.
- **Per-row sync icon**: `RefreshCw` button in the existing actions cell (left of the
  delete icon). Spins (`animate-spin`) while pending. On click (stop propagation):
  `supabase.functions.invoke('sync-clickup-actuals', { body: { project_id: r.id } })`,
  then invalidate `['retainers']` and `['pulseRetainerBurn']`; `toast.success`/`error`.
  Mirror the invoke pattern in `src/pages/ProjectDetail.tsx` /
  `src/components/dashboard/DashboardProjectView.tsx`.
- **Header "Sync all"** button (left of "New retainer"): invokes
  `sync-clickup-actuals` with **no body** (syncs all in-progress projects); same
  invalidation; disabled + spinner while pending.
- Encapsulate the invoke + invalidation in a `useSyncActuals` hook (one for the row,
  reused by the header) to keep the page component thin.

### Data flow

```
[Sync icon / Sync all]
  → invoke sync-clickup-actuals ({project_id} | no body)
    → gather task IDs: project_actuals_current ∪ provisioned_tasks(current period)
    → ClickUp time entries → sum hours
    → INSERT project_actuals rows (append-only)
  → invalidate ['retainers'], ['pulseRetainerBurn']
    → usePulseRetainerBurn re-reads project_actuals_current
      → computeRetainerBurn → Hours used column updates
```

## Testing

- **`sync-clickup-actuals`**: unit-test the provisioned-task gathering — new task IDs
  are picked up, deduped against existing actuals, `planned_hours` derived correctly,
  rows inserted append-only. (Mock the ClickUp fetch + Supabase client.)
- **`computeRetainerBurn`**: already covered by `usePulseRetainerBurn.test` — no change.
- **`RetainersList`**: render test — Hours-used cell shows `used / target` + bar for a
  retainer with burn data and `—` without; sync icon disabled/spinning while pending;
  clicking invokes with the right `project_id` and does not navigate (stop propagation).

## Rollout

1. Backend change + redeploy `sync-clickup-actuals`.
2. Frontend change.
3. Verify end-to-end against the live "Test Conductor" retainer: click the row's sync
   icon → the 2h tracked on "Brendan — recurring on 2026-06-01" appears as `2.0 / 10h`
   with a green bar.
