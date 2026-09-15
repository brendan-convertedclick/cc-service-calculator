-- 0174_an_open_task_can_be_adopted_into_capacity.sql
-- Apply via mcp__cc-supabase__apply_migration (name: an_open_task_can_be_adopted_into_capacity)
--
-- Lisa, 2026-09-15: "going forward we want to be able to have Open Tasks
-- that Rize uses to track time against ... internal, never billable, but
-- captured in capacity." The team's ClickUp time for August put 19h of
-- Brendan's and 33h of Lisa's on perpetual tasks Conductor had never seen
-- (Ops Development Hours, Dashboard Development, Quartz Development Hours,
-- the Conductor review task). Capacity counts closed tasks, and these never
-- close, so they were invisible.
--
-- ongoing_tasks is already the shape for a perpetual task: the sync pulls
-- /task/{id}/time for every active row into ongoing_actuals. Two things
-- stood in the way of registering an existing ClickUp task there:
--   1. ongoing_tasks_overhead_uniq allows one row per person per category,
--      which is the Team page's provisioning rule, not a fact about every
--      perpetual task. `adopted` marks a row registered from an existing
--      task and the index now ignores those.
--   2. ongoing_actuals_current carried the hours but not the entries, and
--      the month a perpetual task's time belongs to is only knowable from
--      the interval dates.

alter table public.ongoing_tasks
  add column if not exists adopted boolean not null default false;

comment on column public.ongoing_tasks.adopted is
  'Registered from an existing ClickUp task (an open task Rize logs against) rather than provisioned by the Team page. Exempt from the one-per-person-per-category rule.';

drop index if exists public.ongoing_tasks_overhead_uniq;
create unique index ongoing_tasks_overhead_uniq
  on public.ongoing_tasks (team_member_id, time_category_id)
  where client_id is null and archived_at is null and not adopted;

-- One registration per ClickUp task; a shared task is registered once and
-- its time is attributed per user from the entries.
create unique index if not exists ongoing_tasks_adopted_task_uniq
  on public.ongoing_tasks (clickup_task_id)
  where adopted and archived_at is null;

create or replace view public.ongoing_actuals_current as
  select distinct on (ongoing_task_id)
    ongoing_task_id, clickup_task_id, cumulative_hours, synced_at, time_entries
  from public.ongoing_actuals
  order by ongoing_task_id, synced_at desc;

-- The tasks the August and September time entries pointed at. Category is
-- Admin / Comms ("ops admin"); the owner is who logged most of the time, and
-- a shared task (Dashboard Development) is registered once.
insert into public.ongoing_tasks (team_member_id, time_category_id, clickup_task_id, task_name, billable, adopted)
select tm.id, 'db5b48d9-8874-40be-b136-25511e50d7fc', v.task_id, v.task_name, false, true
from (values
  ('Brendan Gunn', '869d96nu2', 'Ops Development Hours (cc-service-calculator)'),
  ('Brendan Gunn', '869dafkut', 'Dashboard Development'),
  ('Brendan Gunn', '869dacgt5', 'Pebble Development'),
  ('Lisa Zietsman', '869eghvqp', 'Review New Client Portal App "The Conductor" & Brief Changes/ Fixes'),
  ('Lisa Zietsman', '869d96v35', 'Quartz Development Hours'),
  ('Lisa Zietsman', '869etkn41', 'Shared Xero lines to resolve'),
  ('Lisa Zietsman', '869emk3mc', 'Operations - Check how we can manage over/ under Retainer Budgets'),
  ('Lisa Zietsman', '869eq43a8', 'Xero Products/ Services - Link to a Procedure')
) as v(owner, task_id, task_name)
join public.team_members tm on tm.full_name = v.owner
on conflict do nothing;
