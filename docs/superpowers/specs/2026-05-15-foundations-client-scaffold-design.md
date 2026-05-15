# Foundations — Client Scaffold

**Status:** Approved for implementation
**Date:** 2026-05-15
**Owner:** Brendan
**Sibling of:** [Live tasks (Ongoing Tasks Matrix Planner)](./2026-05-15-ongoing-tasks-matrix-planner.md)

---

## 1. Purpose

Every client folder in ClickUp should contain a consistent baseline of Lists (e.g. *Administration*, *Delivery*, *Meetings*, *Strategic*), with optional canonical seed tasks. Today, this is done manually and drifts. **Foundations** is the app-side counterpart that:

1. Defines an editable catalog of baseline Lists (and optional seed tasks per List).
2. Provisions the baseline into a client's ClickUp folder when a new client is created.
3. Lets the user roll a newly-added baseline List (or task) onto existing clients in bulk — *upkeep*.

This is the second item under the **Scaffold** nav section, next to *Live tasks*.

## 2. Naming & nav

- Page label: **Foundations**
- Route: `/scaffold/foundations`
- Icon: `LayoutTemplate` (lucide)
- Sits in `navSections[Scaffold].items` after `liveTasks`.

## 3. Data model — migration `0049_foundations.sql`

### 3.1 `baseline_lists`

One row = "every client should have a List in this `task_group`".

```sql
create table public.baseline_lists (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.task_groups(id) on delete restrict,
  label         text not null,
  description   text,
  display_order int not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index baseline_lists_group_id_idx
  on public.baseline_lists (group_id)
  where archived_at is null;
```

> One baseline per group keeps the model simple — if you want two Lists in the same group, add a second `task_group` row (cheap).

### 3.2 `baseline_tasks`

Optional canonical seed tasks per baseline list.

```sql
create table public.baseline_tasks (
  id                uuid primary key default gen_random_uuid(),
  baseline_list_id  uuid not null references public.baseline_lists(id) on delete cascade,
  name              text not null,
  description       text,
  display_order     int not null default 0,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index baseline_tasks_list_idx on public.baseline_tasks (baseline_list_id);
```

### 3.3 `client_baseline_tasks_log`

Idempotency journal — once a baseline task has been created in CU for a client, we don't recreate it.

```sql
create table public.client_baseline_tasks_log (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  baseline_task_id  uuid not null references public.baseline_tasks(id) on delete cascade,
  clickup_task_id   text not null,
  created_at        timestamptz not null default now(),
  unique (client_id, baseline_task_id)
);
```

> `client_lists` already exists for the List side, so we don't need a separate log for Lists — presence of a `client_lists` row with the matching `group_id` *is* the idempotency check.

### 3.4 Seed

Seed `baseline_lists` for the four existing `task_groups` so the table isn't empty on first load:

```sql
insert into baseline_lists (group_id, label, display_order)
select id, label, display_order from task_groups
where archived_at is null
order by display_order;
```

## 4. Edge function — `apply-foundations`

Path: `supabase/functions/apply-foundations/index.ts`. Deployed with `verify_jwt = false` (per project convention).

**Input:**

```ts
{
  client_ids: string[];            // required, ≥1
  baseline_list_ids?: string[];    // omit = all active baseline_lists
  include_tasks?: boolean;         // default true
}
```

**Behaviour, per (client × baseline_list):**

1. Skip if client has `clickup_folder_id = null` (log to a returned `skipped[]` array with reason).
2. **Ensure List exists**: look for `client_lists` row with `group_id = baseline.group_id` (active). If none → call internal CU-create logic (same shape as `create-client-list`) with `label = baseline_list.label`, insert `client_lists` row.
3. **If `include_tasks`** → for each `baseline_tasks` row (active, ordered by `display_order`):
   - Skip if `client_baseline_tasks_log` row already exists for `(client_id, baseline_task_id)`.
   - Create CU task in the resolved `clickup_list_id` (status `to do`, no assignee, name = `baseline_task.name`, description from `baseline_task.description`).
   - Insert `client_baseline_tasks_log` row.

**Output:**

```ts
{
  applied: {
    client_id: string;
    lists_created: number;
    lists_existing: number;
    tasks_created: number;
    tasks_existing: number;
  }[];
  skipped: { client_id: string; reason: string }[];
}
```

**Shared logic.** Refactor the CU-list-create body of `create-client-list/index.ts` into `supabase/functions/_shared/clickup-lists.ts` exposing `ensureClientList({ clientId, groupId, label })`. Both edge functions call the helper. CU task creation reuses the existing pattern in `provision-ongoing-tasks` — extract `createClickUpTask(...)` into `_shared/clickup-tasks.ts` similarly. (Minimal refactor; only the lines that actually move.)

## 5. Frontend

### 5.1 Types

Add to `src/types/foundations.ts`:

```ts
export type BaselineList   = Database["public"]["Tables"]["baseline_lists"]["Row"];
export type BaselineTask   = Database["public"]["Tables"]["baseline_tasks"]["Row"];
export type ApplyResult    = { /* mirrors edge fn output */ };
```

Regenerate `src/types/db.ts` after migration via Supabase CLI.

### 5.2 Hooks — `src/hooks/useFoundations.ts`

- `useBaselineLists()` — joined with `task_groups` and a count of `baseline_tasks`.
- `useBaselineTasks(listId)`.
- `useCreateBaselineList`, `useUpdateBaselineList`, `useArchiveBaselineList`.
- `useCreateBaselineTask`, `useUpdateBaselineTask`, `useArchiveBaselineTask`.
- `useApplyFoundations()` — invokes `apply-foundations` edge fn, invalidates `["client-lists", *]`.
- `useFoundationsCoverage()` — single query that returns rows of `{ baseline_list_id, client_id, has_list: boolean, tasks_created: number, tasks_total: number }` by joining `baseline_lists × clients × client_lists × client_baseline_tasks_log`. Implemented as a Postgres view `v_foundations_coverage` to keep the client query trivial.

### 5.3 Page — `src/pages/Foundations.tsx`

Three stacked sections, each in a Card:

**A. Baseline catalog editor** (top)
Table of `baseline_lists`, grouped by `task_group`. Per row: label, description, task count, archive button. Click a row → side-drawer expands to edit `baseline_tasks` (name, description, order, archive). "+ Add baseline" creates a new row (picks group from dropdown of active `task_groups`).

**B. Coverage matrix** (middle)
Rows = active baseline_lists (label + group). Columns = active clients ordered by name. Cells render:
- `✓` (green) — List exists. If the baseline has tasks, the cell shows `T/N` where `T = tasks_created`, `N = baseline tasks total`. Full coverage = bold ✓.
- `·` (muted) — missing.
- `⏳` — apply in flight.

Cell click → applies that single pair (single client, single list).
Row header click → "Apply this baseline to all clients" confirm.
Column header click → "Apply all baselines to this client" confirm.

**C. Bulk apply** (bottom)
Two multi-select chips lists: *Baseline Lists* and *Clients*. Toggle: "Include seed tasks" (default on). Button: "Apply foundations". Disabled until both pickers have ≥1 selection. On success, toast shows summary `Applied N lists, M tasks across K clients.`

### 5.4 Client creation hook

`src/pages/Clients.tsx` "Add Client" dialog (or wherever the new-client form lives — locate during implementation). After the row is inserted **and** the user supplies/sets a `clickup_folder_id`:

- Show a checkbox **"Apply foundations now"** (default checked) + a sub-toggle **"Include seed tasks"** (default checked).
- On submit, if checked, call `useApplyFoundations({ client_ids: [newId], include_tasks })`.

If a new client is created without a `clickup_folder_id`, the checkbox is disabled with a hint "Set a ClickUp folder first, then apply foundations from /scaffold/foundations."

## 6. Routing

Add to `src/App.tsx`:

```tsx
<Route path="/scaffold/foundations" element={<Foundations />} />
```

Add to `src/components/nav/navItems.ts`:

```ts
const foundations: NavItem = {
  to: "/scaffold/foundations",
  label: "Foundations",
  icon: LayoutTemplate,
  end: false,
  gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)",
  color: "#6366F1",
};
```

Insert after `liveTasks` in the *Scaffold* section.

## 7. Verification

**Playwright (`tests/e2e/foundations.spec.ts`):**

1. Log in, navigate to `/scaffold/foundations`. Assert seeded baseline_lists render.
2. Add a new baseline_list "Strategic" under group *Delivery*. Assert it appears in catalog + coverage matrix.
3. Add a baseline_task "Quarterly review" under it. Assert task count = 1.
4. Bulk apply that baseline to 2 active clients. Mock the edge function (intercept `apply-foundations` with a 200 stub). Assert toast and coverage cells go green.
5. Re-apply — assert toast says "0 created" (idempotent).
6. New client creation flow with toggle on: stub edge function, assert it's called with the new client_id.

**Manual smoke** with `npm run dev -- --port 5391` for visual check + screenshot.

## 8. Out of scope (V1 of Foundations)

- Two baseline Lists in the same `task_group`.
- Editing tasks on already-provisioned client tasks (out of scope — only creation tracked).
- Removing baseline → de-provisioning from clients (we only add).
- Assignees / due dates / dependencies on seed tasks.
- Per-client overrides (every client gets the same baseline; if you don't want a List for a client, just don't apply it).

## 9. Implementation order

1. Migration `0049_foundations.sql` (tables + view + seed).
2. Regenerate types.
3. Edge function `apply-foundations` + shared helpers.
4. Hooks + types.
5. `Foundations.tsx` page (sections A → B → C).
6. Nav + route.
7. Client creation hook.
8. Playwright tests.
9. Manual smoke + screenshot.
