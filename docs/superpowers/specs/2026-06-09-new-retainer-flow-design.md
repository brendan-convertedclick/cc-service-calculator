# New Retainer Flow — Design

**Date:** 2026-06-09
**Status:** Draft for review
**Author:** Brendan + Claude

## Problem

Conductor models a retainer as a `projects` row with `engagement_type = 'retainer'` plus
monthly commercial terms (`retainer_hours_target`, `retainer_monthly_fee_cents`) and a set of
recurring services (`retainer_recurring_services`) that the Phase 8 provisioner turns into
ClickUp tasks each month. **None of this has a creation path.**

- Projects are only born when a quote is accepted (`push-to-clickup`), and that insert never
  sets `engagement_type`, so every app-created project is `'fixed'`.
- The retainer editing card in `ProjectDetail` only renders when `engagement_type === 'retainer'`,
  so you can't even flip an existing project into a retainer.
- `retainer_recurring_services` has **zero insert path** anywhere in `src/`, `supabase/`, or
  `mcp-server/` — the table is fully wired for provisioning but can never be populated.
- The Pulse retainer-burn dashboard reads retainers but filters on a status value that
  cannot exist (see Bug, below), so it always shows nothing.

The only retainers that can exist today are ones inserted by hand in the DB.

## Goal

A standalone **New Retainer** flow under the Delivery nav group that creates a retainer project
directly — client, ClickUp list, monthly hours target, monthly fee, and one or more recurring
services — bypassing the brief → quote → accept chain, and immediately provisions the current
period's ClickUp tasks via the existing Phase 8 machinery.

## Decisions (locked during brainstorming)

1. **Output:** a `engagement_type='retainer'` project **plus** recurring services that feed the
   existing Phase 8 provisioner (`provision-retainer-period`).
2. **Provision timing:** provision the current period's ClickUp tasks **immediately on save**;
   the monthly roll-forward cron handles every subsequent month.
3. **Services:** at least one recurring service is **required** to create a retainer.
4. **Architecture:** a new `create-retainer` edge function orchestrates everything server-side
   (Approach 1), mirroring the existing `push-to-clickup` orchestrator.

## Architecture overview

```
NewRetainerWizard (3 steps)
      │  POST { client, list, terms, services[] }
      ▼
create-retainer  (edge function, service role + ClickUp PAT, verify_jwt=false)
      │ 1. create ClickUp "retainer parent" task in clickup_list_id
      │ 2. insert projects row (engagement_type='retainer', status='in_progress', is_recurring=false)
      │ 3. insert retainer_recurring_services rows
      │ 4. invoke provision-retainer-period { project_id }  ──► provisioned_tasks + ClickUp child tasks
      ▼
returns { project_id } ──► navigate to /projects/:id (existing ProjectDetail renders the retainer card)
```

Monthly thereafter: `roll-forward-recurring-tasks` (existing cron) is extended to pick up
`engagement_type='retainer'` projects and re-invoke `provision-retainer-period`.

## Why retainers stay `is_recurring = false`

To get automatic monthly provisioning, the monthly cron `roll-forward-recurring-tasks` must see
the retainer. That cron currently selects `is_recurring = true` — but so does the **daily**
`create-recurring-tasks` cron (the quote-driven "whole project" path that clones
`project_actuals_current` as child tasks). If a retainer were `is_recurring = true`, both crons
would fire and double-provision.

**Resolution:** keep retainer projects `is_recurring = false` and extend
`roll-forward-recurring-tasks` to also select `engagement_type = 'retainer'`. This keeps the two
provisioning mechanisms fully separate with a one-line query change and no risk of duplicate tasks.
`provision-retainer-period` does not read `is_recurring`, so it is unaffected.

## Components

### New files

| File | Purpose |
|------|---------|
| `supabase/functions/create-retainer/index.ts` | Orchestrator: ClickUp parent task → project insert → recurring-services insert → provision. |
| `src/pages/NewRetainerWizard.tsx` | 3-step guided creation form. |
| `src/pages/RetainersList.tsx` | Nav destination: table of retainer projects + "New retainer" CTA. |
| `src/hooks/useCreateRetainer.ts` | Mutation that invokes `create-retainer`; navigates + invalidates on success. |
| `src/hooks/useRetainers.ts` | Query for `engagement_type='retainer'` projects (list page). |

### Modified files

| File | Change |
|------|--------|
| `src/components/nav/navItems.ts` | Add a `retainers` `NavItem` (`/retainers`) into the **Delivery** section's `items`. |
| `src/App.tsx` | Add routes `/retainers` → `RetainersList` and `/retainers/new` → `NewRetainerWizard`. |
| `supabase/functions/roll-forward-recurring-tasks/index.ts` | Extend project selector to `is_recurring=true OR engagement_type='retainer'` (Supabase `.or(...)`), still excluding archived. |
| `src/hooks/usePulseRetainerBurn.ts` | **Bug fix:** change `.eq('status','active')` → `.eq('status','in_progress')` so retainers actually surface in Pulse burn. |

### No new tables

Reuses `projects`, `retainer_recurring_services`, `provisioned_tasks`, `client_lists`,
`team_members`, `services`. No migration required (the Pulse fix is a client query change, not a
schema change).

## `create-retainer` edge function contract

**Request body**

```ts
{
  client_id: string,
  clickup_list_id: string,            // one of the client's client_lists rows
  name: string,                       // e.g. "Acme retainer"
  retainer_hours_target: number,      // hours/month, numeric(6,2)
  retainer_monthly_fee_cents: number, // int cents (ZAR)
  recurrence_start: string,           // ISO date, when the retainer begins
  services: Array<{
    service_id: string,
    cadence: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom',
    occurrences_per_month: number,    // > 0
    points_per_occurrence: number,    // > 0  (1 pt = 15 min)
    default_assignees: string[],      // team_members.id[]
    is_live_eligible: boolean
  }>
}
```

**Validation (return 400 on failure)**

- `services.length >= 1`.
- Each service: `occurrences_per_month > 0`, `points_per_occurrence > 0`, valid `cadence`, and
  `default_assignees.length >= 1` — `provision-retainer-period` creates one task **per assignee**,
  so a service with no assignees provisions nothing and is silently inert.
- `client_id` exists; `clickup_list_id` belongs to that client (lookup in `client_lists`).

**Steps**

1. Load client `name`; confirm `clickup_list_id` is an active `client_lists` row for the client.
2. Create a ClickUp parent task in `clickup_list_id`, name `"[Retainer] {client} — {name}"`.
   **Omit `status`** in the task body (Clients space default-status gotcha → CRTSK_001). Capture `task.id`.
3. Insert the `projects` row (service-role client):
   - `name`, `client_id`,
   - `engagement_type = 'retainer'`,
   - `status = 'in_progress'`,
   - `is_recurring = false`, `recurrence_mode = 'none'`, `recurrence_interval = 'monthly'`,
   - `recurrence_start`,
   - `retainer_hours_target`, `retainer_monthly_fee_cents`,
   - `clickup_list_id`, `clickup_parent_task_id = task.id`.
   - Capture `project_id`.
4. Insert one `retainer_recurring_services` row per service (project-scoped).
5. Invoke `provision-retainer-period` with `{ project_id }` (defaults to the current calendar month).
6. Return `{ project_id, clickup_parent_task_id, provision: <result> }`.

**Error handling / cleanup** (mirrors `push-to-clickup`'s delete-on-failure pattern)

- ClickUp parent task must exist before the project insert (column is `NOT NULL`). If task
  creation fails → 502, nothing written.
- If the recurring-services insert (step 4) fails → delete the project row and best-effort delete
  the ClickUp parent task; return 500.
- If provisioning (step 5) fails → keep the project + services (they are valid and the monthly
  cron / a manual retry can provision later); return `200` with a `provision_warning` so the UI
  can surface "created, but first-period provisioning needs a retry".

**Deploy:** with `verify_jwt = false` (project convention — the gateway can't validate ES256 user
tokens; all edge functions in this repo deploy this way).

## Wizard UX (`/retainers/new`)

Three steps with a progress indicator (reuse the existing `ProgressStepper` styling if it fits).

**Step 1 — Terms**
- Client — searchable select (`useClients`).
- ClickUp list — dropdown from `useClientLists(clientId)`. If the client has no lists, show an
  inline hint linking to the client's structure sync ("This client has no ClickUp lists yet —
  sync structure first"). Block progress until a list is chosen.
- Retainer name — text, defaults to `"{clientName} retainer"`.
- Start date — date, defaults to today.
- Monthly hours target — number.
- Monthly fee (ZAR) — number, converted to cents on submit.

**Step 2 — Recurring services (≥ 1 required)**
- Repeatable rows. Add a service via `ServicePicker`. Per row:
  - cadence (select), occurrences/month (number), points/occurrence (number),
  - default assignees (multi-select from `team_members`, **at least one required**), live-eligible (toggle).
- Running summary: total points/month across rows (× 15 min for an hours estimate).
- "Next/Review" disabled until at least one valid service row exists (valid = service picked,
  positive occurrences and points, and ≥ 1 assignee).

**Step 3 — Review & create**
- Read-only summary of terms + services.
- "Create retainer" → `useCreateRetainer`. On success: toast, navigate to `/projects/{id}`
  (existing `ProjectDetail` already renders the retainer monthly-target card), and invalidate
  `['projects']`, `['retainers']`, `['pulseRetainerBurn']`. On `provision_warning`, toast a
  non-blocking warning.

## `RetainersList` (`/retainers`)

The nav destination. A table of retainer projects (client, name, monthly fee, hours target,
status) sourced from `useRetainers`; each row links to `/projects/{id}`. A prominent
"New retainer" button routes to `/retainers/new`. Kept intentionally minimal — Pulse already owns
the burn analytics.

## Error handling summary

- **No ClickUp list for client:** wizard blocks at Step 1 with a guiding hint; never reaches the
  edge function without a list.
- **ClickUp parent creation fails:** 502, nothing persisted; wizard shows the error and stays open.
- **Partial DB failure:** edge function rolls back the project + parent task.
- **Provision fails after create:** retainer is created; non-blocking warning; recoverable via the
  monthly cron or a manual re-provision.

## Testing

- **`create-retainer`:** unit-test the pure helpers — payload validation, project-row builder, and
  recurring-services-row builder — following the repo's Deno test pattern
  (`_shared/clickup.test.ts`). The ClickUp/provision calls are covered by manual verification
  against a test client.
- **`usePulseRetainerBurn`:** update the existing test to assert the `status='in_progress'` filter;
  add a case proving a seeded `in_progress` retainer is returned.
- **`useCreateRetainer`:** mock `supabase.functions.invoke`; assert payload shape, success
  navigation, and query invalidation.
- **Wizard:** validation tests — cannot advance past Step 1 without client + list; cannot create
  with zero services; fee converts to cents correctly.
- **`roll-forward-recurring-tasks`:** test the selector now matches an `engagement_type='retainer'`,
  `is_recurring=false` project (and still matches `is_recurring=true` non-retainers).

## Out of scope (V1)

- Linking the flow to retainer-classified briefs (`intent_type='retainer_thread'`) — standalone only.
- Editing recurring services after creation (a `ProjectDetail` enhancement) — follow-up.
- SoW / quote / cost-estimate PDFs for retainers.
- Per-user roles / approval gates on creation.
- Pausing or ending a retainer (status lifecycle beyond `in_progress`).

## Open questions

None blocking. Two notes for the implementer:

- Confirm the ClickUp PAT env var name used by `provision-retainer-period` and reuse it in
  `create-retainer` (same secret).
- Decide the exact "retainer parent" task naming/convention with the team if `[Retainer] {client} — {name}`
  isn't preferred; cosmetic only.
