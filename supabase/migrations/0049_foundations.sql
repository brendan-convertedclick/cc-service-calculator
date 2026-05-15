-- supabase/migrations/0049_foundations.sql
--
-- Foundations: client-side scaffolding. Defines a per-task_group catalog of
-- baseline Lists (and optional canonical seed tasks per list). The
-- apply-foundations edge function reads this catalog and provisions the
-- missing pieces into each selected client's ClickUp folder.
--
-- Idempotency:
--   * Lists: presence of a non-archived `client_lists` row with the matching
--     `group_id` for a client is the "already provisioned" signal — no
--     separate log table needed.
--   * Tasks: `client_baseline_tasks_log` journals every CU task ever created
--     from a baseline_task for a given client. Re-application is a no-op.

-- 1. baseline_lists
create table public.baseline_lists (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.task_groups(id) on delete restrict,
  label         text not null,
  description   text,
  display_order int  not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index baseline_lists_group_id_idx
  on public.baseline_lists (group_id)
  where archived_at is null;

alter table public.baseline_lists enable row level security;

create policy "baseline_lists are readable by anon and authenticated"
  on public.baseline_lists for select
  using (true);

create policy "baseline_lists are writable by authenticated"
  on public.baseline_lists for all
  to authenticated
  using (true)
  with check (true);

-- 2. baseline_tasks
create table public.baseline_tasks (
  id                uuid primary key default gen_random_uuid(),
  baseline_list_id  uuid not null references public.baseline_lists(id) on delete cascade,
  name              text not null,
  description       text,
  display_order     int  not null default 0,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index baseline_tasks_list_idx on public.baseline_tasks (baseline_list_id);

alter table public.baseline_tasks enable row level security;

create policy "baseline_tasks are readable by anon and authenticated"
  on public.baseline_tasks for select
  using (true);

create policy "baseline_tasks are writable by authenticated"
  on public.baseline_tasks for all
  to authenticated
  using (true)
  with check (true);

-- 3. client_baseline_tasks_log
create table public.client_baseline_tasks_log (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  baseline_task_id  uuid not null references public.baseline_tasks(id) on delete cascade,
  clickup_task_id   text not null,
  created_at        timestamptz not null default now(),
  unique (client_id, baseline_task_id)
);

create index client_baseline_tasks_log_client_idx
  on public.client_baseline_tasks_log (client_id);

alter table public.client_baseline_tasks_log enable row level security;

create policy "client_baseline_tasks_log is readable by anon and authenticated"
  on public.client_baseline_tasks_log for select
  using (true);

create policy "client_baseline_tasks_log is writable by authenticated"
  on public.client_baseline_tasks_log for all
  to authenticated
  using (true)
  with check (true);

-- 4. Coverage view. One row per (baseline_list × active client) with quick
--    flags + task counts. Used by the Foundations matrix UI.
create or replace view public.v_foundations_coverage as
with active_clients as (
  select id as client_id, name as client_name, clickup_folder_id, short_name
    from public.clients
   where archived_at is null
),
active_baseline_lists as (
  select id as baseline_list_id, label, group_id, display_order
    from public.baseline_lists
   where archived_at is null
),
task_counts as (
  select baseline_list_id, count(*)::int as tasks_total
    from public.baseline_tasks
   where archived_at is null
   group by baseline_list_id
),
log_counts as (
  select l.client_id, bt.baseline_list_id, count(*)::int as tasks_created
    from public.client_baseline_tasks_log l
    join public.baseline_tasks bt on bt.id = l.baseline_task_id
   group by l.client_id, bt.baseline_list_id
)
select
  abl.baseline_list_id,
  abl.label                      as baseline_label,
  abl.group_id,
  abl.display_order,
  ac.client_id,
  ac.client_name,
  ac.short_name,
  ac.clickup_folder_id,
  (cl.id is not null)            as has_list,
  cl.clickup_list_id,
  coalesce(tc.tasks_total, 0)    as tasks_total,
  coalesce(lc.tasks_created, 0)  as tasks_created
from active_baseline_lists abl
cross join active_clients ac
left join public.client_lists cl
  on cl.client_id   = ac.client_id
 and cl.group_id    = abl.group_id
 and cl.archived_at is null
 and cl.custom_label is null
left join task_counts tc on tc.baseline_list_id = abl.baseline_list_id
left join log_counts  lc on lc.baseline_list_id = abl.baseline_list_id and lc.client_id = ac.client_id;

-- 5. Seed: one baseline_list per existing active task_group (id-stable).
insert into public.baseline_lists (group_id, label, display_order)
select tg.id, tg.label, tg.display_order
  from public.task_groups tg
 where tg.archived_at is null
   and not exists (
     select 1 from public.baseline_lists bl
      where bl.group_id = tg.id and bl.archived_at is null
   );
