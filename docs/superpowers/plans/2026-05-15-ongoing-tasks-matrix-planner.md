# Ongoing Tasks Matrix Planner

**Status:** Draft for review
**Date:** 2026-05-15
**Owner:** Brendan
**Scope:** Phase 1 of the ongoing-tasks expansion. Per-(member × client × group × task_template) perpetual ClickUp tasks, provisioned via a four-axis planner UI. Project tasks remain unchanged and continue to live in the same client Folder alongside ongoing tasks.

---

## 1. Background

The existing model (migration `0046_ongoing_tasks.sql`) provisions one perpetual ClickUp task per `(team_member × time_category)` for overhead-only buckets (Standup, Admin, Learning, Sales-BD, Internal Meetings). All tasks live in a single workspace-level list at `settings.clickup_internal_list_id`. Rize.io reads task names + assignees to auto-allocate time.

We're expanding to **per-client** ongoing tasks (e.g. "Brendan — Acme — Client Meeting") so Rize can route client-side overhead (meetings, reactive comms, account admin) to the right client bucket. Project work continues to land in the client's normal lists via the `/brief` flow.

Key design constraints from the planning conversation:

- **Granularity:** `member × client × task_template`, grouped under an app-side `task_groups` concept that maps to ClickUp Lists.
- **CU structure is the source of truth for Folders/Lists.** The app discovers what already exists in each client's Folder. New Lists are only created when the user explicitly clicks "+ New list".
- **Custom tasks/lists are client-scoped by default, with a one-click "Promote to global catalog" affordance.**
- **Same-list coexistence:** ongoing tasks and project tasks live in the same CU lists; ongoing tasks are pinned to "in progress" and never close.
- **Init UX is a four-axis planner:** select clients × select group × select task templates × select members → one "Create" button provisions the entire matrix.

---

## 2. Data model

### 2.0 Prerequisite: `clients.short_name`

```sql
alter table public.clients
  add column short_name text;

update public.clients
   set short_name = name
 where short_name is null;

alter table public.clients
  alter column short_name set not null;

create unique index clients_short_name_idx
  on public.clients (short_name)
  where archived_at is null;
```

Used in CU task names: `[Ongoing] {member.full_name} — {client.short_name} — {template.label}`. Editable from the client settings screen so the user can shorten "Acme Industrial (Pty) Ltd" → "Acme" for cleaner Rize matching.

### 2.1 New table: `task_groups`

Top-level groupings (Administration, Delivery, Meetings, …). One row = one logical "List" in the agency's taxonomy. Maps to actual CU Lists per client via `client_lists`.

```sql
create table public.task_groups (
  id            uuid primary key default gen_random_uuid(),
  label_key     text not null unique,
  label         text not null,
  description   text,
  display_order int not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

**Seed:**

```sql
insert into task_groups (label_key, label, display_order) values
  ('administration', 'Administration', 10),
  ('delivery',       'Delivery',       20),
  ('meetings',       'Meetings',       30),
  ('overhead',       'Overhead',       40);  -- catch-all for member-only categories
```

### 2.2 Rename + extend: `time_categories` → `task_templates`

Today's `time_categories` becomes the **catalog of task templates**. A task template is "Client Meeting", "Weekly Reporting", "Daily Standup" — a reusable shape. Each template belongs to a `task_group` (e.g. "Client Meeting" → Meetings group).

```sql
alter table public.time_categories rename to task_templates;

alter table public.task_templates
  add column group_id  uuid references public.task_groups(id) on delete restrict,
  add column is_custom boolean not null default false,
  add column client_id uuid references public.clients(id) on delete cascade;

-- Custom templates are scoped to a client; global templates are not.
alter table public.task_templates
  add constraint task_templates_custom_scope_chk
  check (
    (is_custom = false and client_id is null) or
    (is_custom = true  and client_id is not null)
  );

-- Backfill existing rows into the Overhead group:
update public.task_templates
   set group_id = (select id from public.task_groups where label_key = 'overhead')
 where group_id is null;

alter table public.task_templates
  alter column group_id set not null;
```

**Promotion path:** `update task_templates set is_custom=false, client_id=null where id=:id` exposes a custom template to the global catalog. Existing `ongoing_tasks` rows that reference it continue to work unchanged.

### 2.3 New table: `client_lists`

Maps an app-side `task_group` to an actual ClickUp List inside a client's Folder. Populated by the discovery sync; only mutated by user action when adding a new list.

```sql
create table public.client_lists (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  group_id          uuid not null references public.task_groups(id) on delete restrict,
  clickup_list_id   text not null,
  clickup_list_name text not null,        -- snapshot for display + drift detection
  custom_label      text,                 -- set when user creates a list via "+ New list"
  discovered_at     timestamptz,          -- null if user-created, set if discovered
  archived_at       timestamptz,
  created_at        timestamptz not null default now()
);

-- A given client can only map one CU list per group (excluding custom rows).
create unique index client_lists_client_group_idx
  on public.client_lists (client_id, group_id)
  where custom_label is null and archived_at is null;

-- A given CU list ID can only be claimed once per client.
create unique index client_lists_client_cu_idx
  on public.client_lists (client_id, clickup_list_id)
  where archived_at is null;
```

### 2.4 Extend: `ongoing_tasks`

Add the client + template + list pointers. Preserve the existing rows by treating `client_id IS NULL` as the legacy member-level overhead case.

```sql
alter table public.ongoing_tasks
  rename column time_category_id to task_template_id;

alter table public.ongoing_tasks
  add column client_id      uuid references public.clients(id) on delete cascade,
  add column client_list_id uuid references public.client_lists(id) on delete restrict;

-- Drop the old uniqueness; replace with two partial uniques.
alter table public.ongoing_tasks
  drop constraint ongoing_tasks_team_member_id_time_category_id_key;

-- Legacy overhead rows (client_id null) — keep one per (member, template).
create unique index ongoing_tasks_overhead_uniq
  on public.ongoing_tasks (team_member_id, task_template_id)
  where client_id is null and archived_at is null;

-- Client-scoped rows — one per (member, client, template).
create unique index ongoing_tasks_client_uniq
  on public.ongoing_tasks (team_member_id, client_id, task_template_id)
  where client_id is not null and archived_at is null;

create index ongoing_tasks_client_idx
  on public.ongoing_tasks (client_id)
  where archived_at is null;
```

### 2.5 Schema diagram

```
clients ─────────────┬──────────────┐
                     │              │
                     ▼              ▼
              client_lists    ongoing_tasks ◄──── team_members
                     │              │
                     ▼              ▼
                task_groups   task_templates
                                    │
                                    ▼
                              task_groups
```

---

## 3. Edge functions

### 3.1 `sync-client-clickup-structure` (new)

**Purpose:** read a client's CU Folder and stage discovered Lists into `client_lists` for user mapping.

**Contract:**

```
POST { client_id: string }
→ 200 { discovered: number, lists: Array<{ clickup_list_id, name, archived }> }
```

**Behavior:**

1. Read `clients.clickup_folder_id` for the given client. 400 if null.
2. `GET https://api.clickup.com/api/v2/folder/{folder_id}/list` (paginate).
3. For each CU list:
   - If a `client_lists` row with this `clickup_list_id` exists and is unarchived, refresh `clickup_list_name`.
   - Otherwise insert a *staging* row: `client_id` set, `group_id` left null until the user maps it. Use `discovered_at = now()`.
4. The frontend then renders a "Map your lists" screen showing every staging row and lets the user assign a `task_group` to each (or archive).

Discovery is idempotent and safe to re-run when CU structure changes.

### 3.2 `provision-ongoing-tasks` (extend)

**New contract:**

```
POST {
  member_ids:        string[],
  client_ids:        string[],   // empty = legacy overhead-only flow
  task_template_ids: string[],
  group_id?:         string,     // required when client_ids non-empty;
                                 // resolves to client_lists.clickup_list_id per client
}
→ 200 {
  provisioned: number,
  skipped:     number,
  failed:      Array<{ member_id, client_id, task_template_id, reason }>
}
```

**Behavior:**

1. Load active members, clients, templates. Validate every template's `group_id` matches the request's `group_id` (or all templates belong to `overhead` group when `client_ids` is empty).
2. For each `(member, client, template)` triple:
   - Resolve target list:
     - `client_id` provided → look up `client_lists` by `(client_id, group_id)` (excluding custom). Reject if missing — caller must run sync + map first.
     - `client_id` null → use `settings.clickup_internal_list_id` (today's behavior).
   - Check existence in `ongoing_tasks` via the relevant partial unique. Skip if present.
   - Build task name:
     - With client: `[Ongoing] {member.full_name} — {client.short_name|client.name} — {template.label}`
     - Without client: `[Internal] {member.full_name} — {template.label}` (unchanged from today)
   - `POST /list/{list_id}/task` to CU with `status: "in progress"`, member assigned.
   - Insert `ongoing_tasks` row referencing `client_list_id` when client-scoped.
3. Row-by-row commit (same orphan-minimisation pattern as today). Failures collected and returned per cell — do **not** fail-fast; the user wants partial-success visibility.
4. Concurrency cap: process triples in batches of 5 to respect CU rate limits.

### 3.3 `create-client-list` (new)

**Purpose:** "+ New list" action on the planner.

```
POST {
  client_id:     string,
  group_id?:     string,   // null = create as a custom_label list
  custom_label?: string,   // required if group_id is null
}
→ 200 { client_list_id, clickup_list_id }
```

Creates a new CU List inside `clients.clickup_folder_id`, then inserts the `client_lists` row.

### 3.4 `promote-task-template` (new, small)

```
POST { task_template_id: string }
→ 200 { id }
```

Sets `is_custom=false, client_id=null` after a single integrity check (label_key not already used by another global template). Existing `ongoing_tasks` rows continue to reference it unchanged.

### 3.5 Existing functions — impact

- **`sync-clickup-actuals`** — no change. It joins on `ongoing_tasks.clickup_task_id`, which still works.
- **`get-productivity`** — no change for Phase 1. The overhead classifier still uses the `ongoing_tasks` set membership check. Phase 2 (out of scope here) could add a per-client breakdown by reading `ongoing_tasks.client_id`.

---

## 4. UI

### 4.1 New page: `/team/ongoing-tasks/plan`

Four-pane layout, mounted as a sub-route under the existing Team page.

```
┌──────────────┬──────────────┬─────────────────────┬──────────────┐
│ CLIENTS      │ GROUP        │ TASKS               │ MEMBERS      │
│ (multi)      │ (single)     │ (multi)             │ (multi)      │
│              │              │                     │              │
│ ☑ Acme       │ ○ Admin      │  Catalog            │ ☑ Brendan    │
│ ☑ Beta       │ ● Meetings   │   ☑ Client Meeting  │ ☐ Sarah      │
│ ☐ Gamma      │ ○ Delivery   │   ☐ Weekly Standup  │ ☑ Mike       │
│ ☐ Delta      │              │   ☑ Account Comms   │              │
│              │              │   [+ Custom task]   │              │
│              │              │                     │              │
├──────────────┴──────────────┴─────────────────────┴──────────────┤
│ Preview: 2 clients × 2 tasks × 2 members = 8 ongoing tasks       │
│ Per client: Acme → list "Client Meetings" (mapped)               │
│             Beta → list "Client Meetings" (mapped)               │
│                                                  [Create]       │
└──────────────────────────────────────────────────────────────────┘
```

**Preview behavior:**

- For each selected client, resolve the CU list for the selected group via `client_lists`. If unmapped, show a red banner: *"Beta Corp has no list mapped for Meetings — [Map now]"* with a deep-link to the mapping screen.
- For each cell, show ✓ "will provision" or ⊘ "already exists" so the user sees the no-op count up front.

**Create action:**

- Hits `provision-ongoing-tasks` with the full matrix.
- Streams progress (use TanStack Query mutation + toast for now; no need for SSE).
- On completion, shows a result drawer: provisioned / skipped / failed (with per-cell error messages).

### 4.2 New page: `/clients/:id/clickup-lists`

The mapping screen.

- Lists every `client_lists` row for the client.
- Row columns: CU list name (read-only), Group dropdown (assignable `task_groups`, or "Custom" with a free-text label), Actions (archive).
- "Sync from ClickUp" button → calls `sync-client-clickup-structure`.
- "+ New list" button → calls `create-client-list`.

### 4.3 New settings sub-screen: `/settings/task-catalog`

- Lists all `task_templates` grouped by `task_groups`.
- Sections: **Global catalog** (is_custom=false) and **Custom** (is_custom=true, grouped by client).
- Actions per row: edit label, archive, **Promote to global** (custom rows only).
- "+ New group" and "+ New global template" affordances.

### 4.4 Existing Team page provision button

Stays. When invoked without a client (today's flow), routes to `provision-ongoing-tasks` with `client_ids=[]` and the overhead-group templates. Equivalent to the legacy behavior.

---

## 5. Implementation sequencing

Each step is independently shippable / reviewable. Recommended order:

1. **Migration `0047_ongoing_tasks_matrix.sql`** — schema, seeds, partial uniques, backfill. Verify legacy `ongoing_tasks` rows still work.
2. **Settings → Task Catalog page** — pure CRUD on `task_groups` + `task_templates`. No CU writes. Ship this first; lets the user see the data model materialised.
3. **`sync-client-clickup-structure` edge function + Client → CU Lists mapping page** — read-only CU integration. Lets the user populate `client_lists` for a few pilot clients.
4. **`create-client-list` edge function + "+ New list" UI** — first CU write path; small, easy to QA.
5. **`provision-ongoing-tasks` extension** — extend the existing edge function (don't fork). Add tests covering: legacy overhead path unchanged, client-scoped path success, unmapped-list rejection, partial failure surfacing.
6. **`/team/ongoing-tasks/plan` four-axis planner page** — final piece; integrates everything above.
7. **`promote-task-template` edge function + Promote button** — small cleanup pass.

Steps 2–6 are individually mergeable into `main`; each gates the next functionally but they can be developed in parallel worktrees if subagents pick them up independently.

---

## 6. Out of scope (defer to Phase 2+)

- Per-client productivity breakdowns (requires `get-productivity` rework).
- Auto-dormancy / state machine (Recommendation 3 in the synthesis).
- Self-serve "My Kit" UX (Recommendation 3).
- Unifying `ongoing_tasks` + project tasks into a single `time_tracks` table (Recommendation 2).
- Calendar-driven lazy provisioning.
- Backfilling Rize.io rules — the user maintains those manually for now.

---

## 7. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Rize Chrome-title matching becomes ambiguous with ~600 perpetual tasks (member × client × template) | Medium | Enforce `[Ongoing]` prefix and client short-name in task title; consider adding `clients.short_name` if it doesn't already exist |
| Partial provision leaves orphan CU tasks | Low | Same row-by-row commit pattern as `0046`; new orphan reconcile job out of scope but flagged for Phase 2 |
| CU rate-limit hit on large matrix (e.g. 10 clients × 5 members × 3 templates = 150 task creates) | Medium | Batch size 5, retry on 429 with backoff |
| User maps the wrong CU list to a group → ongoing tasks land in wrong place | Low | Mapping page shows the CU list's task count + last activity as a sanity hint; rows are archivable, not deletable, so recovery is undo + remap |
| `clients.short_name` doesn't exist and `clients.name` collides on Chrome match (e.g. two clients both contain "Inc") | Medium | Add `clients.short_name text` as a prerequisite migration; backfill from `name` then let user edit |

---

## 8. Resolved design decisions

1. **`clients.short_name`** is added as a prerequisite column in migration `0047`. Backfilled from `name`, editable in the client settings screen. Used in CU task titles to disambiguate Rize matching.
2. **Discovery surfaces every CU list** in the client's Folder. User explicitly maps each to a `task_group` or archives. No name-based heuristics.
3. **Seeded groups:** Administration, Delivery, Meetings, Overhead. Additional groups added via the Task Catalog UI.
4. **Promotion is future-only.** Existing client-scoped `ongoing_tasks` continue to reference the now-global template; other clients pick it up from the next provisioning run.
