-- supabase/migrations/0048_ongoing_tasks_matrix.sql
--
-- Ongoing tasks matrix expansion. Adds per-(member × client × template)
-- granularity on top of the (member × time_category) overhead model from 0046.
--
-- The existing `time_categories` table is kept under its original name to
-- avoid breaking live code (provision-ongoing-tasks, useOngoingTasks, db.ts
-- types). Conceptually it now functions as the "task templates catalog" —
-- the TS layer aliases it as TaskTemplate. Rows gain a group_id (mandatory),
-- and optional is_custom + client_id columns for client-scoped custom
-- templates that can later be promoted to the global catalog.
--
-- Net changes:
--   * clients.short_name — disambiguates Rize Chrome-title matching
--   * task_groups        — top-level groupings (Administration, Delivery,
--                          Meetings, Overhead) mapping 1:1 to a ClickUp List
--                          inside each client's Folder
--   * time_categories    — extended in place with group_id, is_custom, client_id
--   * client_lists       — (client × group) → ClickUp List mapping, populated
--                          by discovery sync
--   * ongoing_tasks      — gains client_id + client_list_id;
--                          old unique replaced with two partial uniques so
--                          legacy overhead rows (client_id null) coexist with
--                          new client-scoped rows

-- 1. clients.short_name (prerequisite). Backfilled from name; editable from
--    the client settings screen so the user can shorten e.g.
--    "Acme Industrial (Pty) Ltd" → "Acme" for cleaner Rize matching.
alter table public.clients
  add column if not exists short_name text;

update public.clients
   set short_name = name
 where short_name is null;

alter table public.clients
  alter column short_name set not null;

create unique index if not exists clients_short_name_idx
  on public.clients (short_name)
  where archived_at is null;

-- 2. task_groups — top-level groupings, one per logical CU list role.
create table public.task_groups (
  id            uuid primary key default gen_random_uuid(),
  label_key     text not null unique,
  label         text not null,
  description   text,
  display_order int  not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index task_groups_active_idx
  on public.task_groups (display_order)
  where archived_at is null;

insert into public.task_groups (label_key, label, description, display_order) values
  ('administration', 'Administration', 'Account admin, comms, ops',                   10),
  ('delivery',       'Delivery',       'Reactive client delivery work',                20),
  ('meetings',       'Meetings',       'Client meetings, reviews, planning',           30),
  ('overhead',       'Overhead',       'Member-level overhead not tied to a client',   40)
on conflict (label_key) do nothing;

-- 3. Extend time_categories (functioning as task templates catalog).
alter table public.time_categories
  add column if not exists group_id  uuid references public.task_groups(id) on delete restrict,
  add column if not exists is_custom boolean not null default false,
  add column if not exists client_id uuid references public.clients(id) on delete cascade;

-- Backfill: every legacy row lands in the Overhead group.
update public.time_categories
   set group_id = (select id from public.task_groups where label_key = 'overhead')
 where group_id is null;

alter table public.time_categories
  alter column group_id set not null;

alter table public.time_categories
  add constraint time_categories_custom_scope_chk
  check (
    (is_custom = false and client_id is null) or
    (is_custom = true  and client_id is not null)
  );

create index time_categories_group_active_idx
  on public.time_categories (group_id, display_order)
  where archived_at is null;

create index time_categories_client_custom_idx
  on public.time_categories (client_id)
  where is_custom = true and archived_at is null;

-- 4. client_lists — discovery-populated mapping of (client × group) →
--    actual ClickUp list inside the client's Folder.
create table public.client_lists (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  group_id          uuid references public.task_groups(id) on delete restrict,
  clickup_list_id   text not null,
  clickup_list_name text not null,
  custom_label      text,
  discovered_at     timestamptz,
  archived_at       timestamptz,
  created_at        timestamptz not null default now()
);

-- One CU list per (client, group) for canonical mapped rows. Custom-labelled
-- rows (custom_label not null, group_id null) bypass this.
create unique index client_lists_client_group_idx
  on public.client_lists (client_id, group_id)
  where custom_label is null and archived_at is null and group_id is not null;

-- A given CU list ID can only be claimed once per client.
create unique index client_lists_client_cu_idx
  on public.client_lists (client_id, clickup_list_id)
  where archived_at is null;

create index client_lists_client_active_idx
  on public.client_lists (client_id)
  where archived_at is null;

-- 5. ongoing_tasks — extend with client + list pointers.
--    NOTE: time_category_id column name is preserved (it still references
--    time_categories, which now functions as the templates catalog).
alter table public.ongoing_tasks
  add column if not exists client_id      uuid references public.clients(id) on delete cascade,
  add column if not exists client_list_id uuid references public.client_lists(id) on delete restrict;

-- Replace the old (team_member_id, time_category_id) unique with two
-- partial uniques: legacy overhead rows (client_id null) and new
-- client-scoped rows coexist.
alter table public.ongoing_tasks
  drop constraint if exists ongoing_tasks_team_member_id_time_category_id_key;

create unique index ongoing_tasks_overhead_uniq
  on public.ongoing_tasks (team_member_id, time_category_id)
  where client_id is null and archived_at is null;

create unique index ongoing_tasks_client_uniq
  on public.ongoing_tasks (team_member_id, client_id, time_category_id)
  where client_id is not null and archived_at is null;

create index ongoing_tasks_client_active_idx
  on public.ongoing_tasks (client_id)
  where client_id is not null and archived_at is null;
