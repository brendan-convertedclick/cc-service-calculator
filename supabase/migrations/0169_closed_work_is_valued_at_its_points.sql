-- 0169_closed_work_is_valued_at_its_points.sql
-- Apply via mcp__cc-supabase__apply_migration (name: closed_work_is_valued_at_its_points)
--
-- Lisa, 2026-09-14: "get to the most accurate number that we see in ClickUp
-- and reflect the same in Conductor so we know nothing is broken." ClickUp's
-- points dashboard sums sprint points on closed tasks. Briefs already carry
-- points; recurring tasks were valued at planned hours and meetings at
-- calendar length, which is why Lisa's August read 112.6h here against
-- 104.25h there. Both now carry the task's points, written by the same sync
-- that already fetches the task.

alter table public.project_actuals
  add column if not exists points numeric;

comment on column public.project_actuals.points is
  'Sprint points on the ClickUp task at the time of this snapshot. Null when the task has none or the snapshot predates 0169.';

alter table public.internal_meeting_tasks
  add column if not exists clickup_points numeric,
  add column if not exists clickup_status text,
  add column if not exists clickup_closed_at timestamptz,
  add column if not exists clickup_synced_at timestamptz;

comment on column public.internal_meeting_tasks.clickup_points is
  'Sprint points on the meeting''s ClickUp task, as last synced. A meeting counts toward capacity at these points once the task is closed, the same rule as a brief.';

create index if not exists idx_internal_meeting_tasks_synced
  on public.internal_meeting_tasks (clickup_synced_at nulls first)
  where clickup_task_id is not null;

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
  to_char(t.period_start, 'YYYY-MM') as month,
  coalesce(pac.status_at_sync, '') in ('complete', 'closed', 'done') as is_closed,
  coalesce(pac.actual_hours, 0) as actual_hours,
  coalesce(pac.planned_hours, 0) as planned_hours,
  pac.points,
  pac.date_closed as closed_at,
  to_char(coalesce(pac.date_closed, t.period_start::timestamptz), 'YYYY-MM') as closed_month
from task t
left join lateral (
  select pa.status_at_sync, pa.actual_hours, pa.planned_hours, pa.points, pa.date_closed
  from public.project_actuals pa
  where pa.project_id = t.project_id
    and pa.clickup_task_id = t.clickup_task_id
  order by pa.recorded_at desc
  limit 1
) pac on true;

comment on view public.retainer_recurring_delivery is
  'One row per provisioned recurring ClickUp task. `month` is the fee month it was provisioned for (retainer delivery); `closed_month` is when it was actually closed (team capacity), falling back to `month` for snapshots older than 0168. `points` is the task''s sprint points at the last snapshot (0169). A provisioned task is never a brief.';

grant select on public.retainer_recurring_delivery to authenticated, service_role;
