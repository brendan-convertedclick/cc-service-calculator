-- 0160_recurring_work_counts_as_delivery.sql
-- Apply via mcp__cc-supabase__apply_migration (name: recurring_work_counts_as_delivery)
--
-- Lisa, 2026-09-08: "accurately tell what is happening per client".
--
-- The Retainers page measured a month's delivery by summing points on closed
-- BRIEFS. That is half the work. The other half is the recurring tasks the
-- provisioner puts into ClickUp every month — the reports, the plugin sweeps,
-- the standing meetings — and none of it counted. Dovetail's SEO retainer
-- closed six provisioned tasks in August and the page read 0h against 7.08h
-- planned; Trellidor's SEO retainer carried twenty of them and read 0h too.
-- A retainer whose whole shape is recurring work therefore looked unserviced
-- however well it was actually run.
--
-- READ-ONLY. One view, no new columns, no data touched.
--
-- SUPERSEDED BY 0161 the same afternoon: this version joins through
-- project_actuals_current and takes 13.6s, which PostgREST kills. 0161 is the
-- same view with that one join rewritten as a lateral. Kept as applied rather
-- than edited in place, because the reason is worth reading.
--
-- The join is the reason this is a view and not four lines in the hook.
-- provisioned_tasks holds the ClickUp ids as an ARRAY per (service × assignee ×
-- period), and the actuals live one-row-per-task in project_actuals_current.
-- Getting from one to the other needs an unnest, which PostgREST cannot express
-- — doing it in the browser would mean shipping both tables down and rebuilding
-- the join in TypeScript, i.e. a second definition of "closed" living next to
-- computeProjectProgress's. There is one definition and it is here.

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
  -- which for every open task is today.
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
left join public.project_actuals_current pac
  on pac.clickup_task_id = t.clickup_task_id;

comment on view public.retainer_recurring_delivery is
  'One row per provisioned recurring ClickUp task, attributed to the month it was provisioned for, with whether it is closed and what it cost. The recurring half of a retainer''s delivery — the brief half comes from briefs.completed_at. The two sets never overlap: a provisioned task is not a brief.';

grant select on public.retainer_recurring_delivery to authenticated, service_role;
