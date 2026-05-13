-- supabase/migrations/0046_ongoing_tasks.sql
--
-- Ongoing tasks model. Each (team_member × time_category) gets one
-- perpetual ClickUp task in the configured internal list. Rize posts
-- time entries against those task IDs; sync-clickup-actuals pulls them
-- back into ongoing_actuals as an append-only snapshot stream.

-- 1. Settings: a single ClickUp list that holds every internal task.
alter table public.settings
  add column if not exists clickup_internal_list_id text;

comment on column public.settings.clickup_internal_list_id is
  'ClickUp list ID that hosts all perpetual ongoing tasks (Standup, '
  'Admin, etc). One list, all team members, all categories.';

-- 2. time_categories — canonical overhead types. Hand-edited via the
--    Settings UI. label_key is a slug used in ClickUp task naming so
--    Rize can match consistently even if the display label changes.
create table public.time_categories (
  id           uuid primary key default gen_random_uuid(),
  label_key    text not null unique,            -- e.g. 'standup'
  label        text not null,                   -- e.g. 'Standup'
  description  text,
  weekly_budget_hours numeric(5,2),             -- optional soft target
  display_order int  not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index time_categories_active_idx
  on public.time_categories (display_order)
  where archived_at is null;

-- 3. ongoing_tasks — one row per (team_member × time_category).
create table public.ongoing_tasks (
  id                uuid primary key default gen_random_uuid(),
  team_member_id    uuid not null references public.team_members(id) on delete cascade,
  time_category_id  uuid not null references public.time_categories(id) on delete restrict,
  clickup_task_id   text not null,
  task_name         text not null,
  provisioned_at    timestamptz not null default now(),
  archived_at       timestamptz,
  unique (team_member_id, time_category_id)
);

create index ongoing_tasks_member_active_idx
  on public.ongoing_tasks (team_member_id)
  where archived_at is null;

create index ongoing_tasks_clickup_idx
  on public.ongoing_tasks (clickup_task_id);

-- 4. ongoing_actuals — append-only snapshots of time entries per
--    ongoing task per sync tick.
create table public.ongoing_actuals (
  id               uuid primary key default gen_random_uuid(),
  ongoing_task_id  uuid not null references public.ongoing_tasks(id) on delete cascade,
  clickup_task_id  text not null,
  cumulative_hours numeric(8,2) not null default 0,
  time_entries     jsonb,
  synced_at        timestamptz not null default now()
);

create index ongoing_actuals_task_synced_idx
  on public.ongoing_actuals (ongoing_task_id, synced_at desc);

-- 5. Latest-snapshot view.
create or replace view public.ongoing_actuals_current as
  select distinct on (ongoing_task_id)
    ongoing_task_id,
    clickup_task_id,
    cumulative_hours,
    synced_at
  from public.ongoing_actuals
  order by ongoing_task_id, synced_at desc;

-- 6. Seed the default time categories.
insert into public.time_categories (label_key, label, description, display_order)
values
  ('standup',           'Standup',           'Daily team stand-up',                       10),
  ('internal-meetings', 'Internal Meetings', 'Non-client meetings (1:1s, retros, etc.)',  20),
  ('admin-comms',       'Admin / Comms',     'Slack, email, internal docs, ops admin',    30),
  ('learning',          'Learning',          'Training, reading, skill-up',               40),
  ('sales-bd',          'Sales / BD',        'Pitches, proposals, prospecting',           50)
on conflict (label_key) do nothing;
