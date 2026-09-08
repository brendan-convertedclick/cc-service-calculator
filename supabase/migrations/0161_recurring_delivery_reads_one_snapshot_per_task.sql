-- 0161_recurring_delivery_reads_one_snapshot_per_task.sql
-- Apply via mcp__cc-supabase__apply_migration (name: recurring_delivery_reads_one_snapshot_per_task)
--
-- Same view as 0160, one join rewritten. 0160 took 13.6 seconds and the page
-- got a 500 — PostgREST's statement timeout, not a bug in the SQL.
--
-- The trap is project_actuals_current. It reads as the obvious source (it is
-- what Pulse uses, and "current" is exactly what we want) but it is a
-- `distinct on (project_id, clickup_task_id) ... order by recorded_at desc`
-- over project_actuals — an APPEND-ONLY snapshot table with 320,463 rows and
-- growing every half hour. Joining it to anything makes the planner build the
-- whole deduplicated set first: 320k rows sorted, to answer a question about
-- 494 tasks.
--
-- The lateral asks the same question the other way round — for THIS task, the
-- newest snapshot — which is one index scan on idx_project_actuals_task_recorded
-- per provisioned task. 494 of those come back in 0.42s.
--
-- It does restate project_actuals_current's newest-per-task rule rather than
-- reusing it, which this codebase otherwise treats as a defect. The rule is
-- three lines and identical (same key, same ordering column, same direction);
-- a 13-second view that times out under PostgREST is not a reusable helper.
-- If project_actuals_current ever changes what "current" means, this changes
-- with it.

drop view if exists public.retainer_recurring_delivery;

create view public.retainer_recurring_delivery
with (security_invoker = true) as
with task as (
  select
    pt.project_id,
    pt.period_start,
    unnest(pt.clickup_task_ids) as clickup_task_id
  from public.provisioned_tasks pt
  where pt.clickup_task_ids is not null
)
select
  t.project_id,
  t.period_start,
  t.clickup_task_id,
  -- The month this work belongs to is the month it was PROVISIONED for, not
  -- the month it happened to be synced in. period_start is that fact and it
  -- never moves; recorded_at is only ever "when we last looked at ClickUp",
  -- which for every open task is today. A September task ticked in October
  -- therefore lands in September, where the fee that paid for it was invoiced.
  to_char(t.period_start, 'YYYY-MM') as month,
  -- Same status set as computeProjectProgress (src/lib/project-status.ts).
  -- Live data only ever writes 'closed', but a ClickUp list is free to name
  -- its done column differently and two of ours already have.
  coalesce(pac.status_at_sync, '') in ('complete', 'closed', 'done') as is_closed,
  coalesce(pac.actual_hours, 0) as actual_hours,
  coalesce(pac.planned_hours, 0) as planned_hours
from task t
-- LEFT, deliberately. About a fifth of provisioned tasks have no actuals row
-- at all — sync-clickup-actuals reads the lists it knows about, and a task in
-- a list it does not cover is invisible to it rather than absent from ClickUp.
-- Dropping those rows would quietly shrink the denominator and make coverage
-- look better than it is; they come through as not-closed with no hours, which
-- is exactly what we know about them.
left join lateral (
  select pa.status_at_sync, pa.actual_hours, pa.planned_hours
  from public.project_actuals pa
  where pa.project_id = t.project_id
    and pa.clickup_task_id = t.clickup_task_id
  order by pa.recorded_at desc
  limit 1
) pac on true;

comment on view public.retainer_recurring_delivery is
  'One row per provisioned recurring ClickUp task, attributed to the month it was provisioned for, with whether it is closed and what it cost. The recurring half of a retainer''s delivery — the brief half comes from briefs.completed_at. The two sets never overlap: a provisioned task is not a brief.';

grant select on public.retainer_recurring_delivery to authenticated, service_role;
