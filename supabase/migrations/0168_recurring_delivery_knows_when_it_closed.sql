-- 0168_recurring_delivery_knows_when_it_closed.sql
-- Apply via mcp__cc-supabase__apply_migration (name: recurring_delivery_knows_when_it_closed)
--
-- Two questions look alike and are not. "Which month's fee paid for this task"
-- is the retainer question, and 0161 answers it with period_start: a September
-- task ticked in October is September's delivery. "Which month did this person
-- spend the time" is the capacity question, and for that the close date is the
-- only honest answer — Lisa's four July GMB weeks and two June TD UK tasks were
-- closed in August and the capacity page could not see them, because it had no
-- close date to key on.
--
-- project_actuals is the snapshot the sync already writes per task per tick;
-- it fetches the task, so date_closed is free. The view keeps `month` (fee
-- month, unchanged) and adds `closed_at` / `closed_month`, which fall back to
-- the period for snapshots taken before this column existed.

alter table public.project_actuals
  add column if not exists date_closed timestamptz;

comment on column public.project_actuals.date_closed is
  'ClickUp date_closed (falling back to date_done) at the time of this snapshot. Null for open tasks and for snapshots written before 0168.';

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
  -- Fee month: the month the work was provisioned for (see 0161). Unchanged.
  to_char(t.period_start, 'YYYY-MM') as month,
  coalesce(pac.status_at_sync, '') in ('complete', 'closed', 'done') as is_closed,
  coalesce(pac.actual_hours, 0) as actual_hours,
  coalesce(pac.planned_hours, 0) as planned_hours,
  -- Capacity month: when the person actually finished it. Older snapshots have
  -- no close date, so they fall back to the fee month rather than vanish.
  pac.date_closed as closed_at,
  to_char(coalesce(pac.date_closed, t.period_start::timestamptz), 'YYYY-MM') as closed_month
from task t
left join lateral (
  select pa.status_at_sync, pa.actual_hours, pa.planned_hours, pa.date_closed
  from public.project_actuals pa
  where pa.project_id = t.project_id
    and pa.clickup_task_id = t.clickup_task_id
  order by pa.recorded_at desc
  limit 1
) pac on true;

comment on view public.retainer_recurring_delivery is
  'One row per provisioned recurring ClickUp task. `month` is the fee month it was provisioned for (retainer delivery); `closed_month` is when it was actually closed (team capacity), falling back to `month` for snapshots older than 0168. The two sets never overlap with briefs: a provisioned task is not a brief.';

grant select on public.retainer_recurring_delivery to authenticated, service_role;
