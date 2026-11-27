-- 0208_project_actuals_drop_repeats.sql
-- Apply via the Management API query endpoint (name: project_actuals_drop_repeats)
--
-- project_actuals is append-only: sync-clickup-actuals writes a fresh row for
-- every seeded task on every tick, changed or not. By 2026-11-13 that was
-- 571,231 rows for 958 tasks (391 MB), and project_actuals_current, which the
-- Projects list reads on every open, took 7.6s to pick the latest row per task
-- (Lisa: "why is there such a delay for projects to load").
--
-- A row identical to both its neighbours says nothing the neighbours don't.
-- Readers need only two things from the history, and both survive:
--   * the latest row per task (project_actuals_current, retainer_recurring_delivery,
--     and the recorded_at windows the burn hooks filter on), which is a run's LAST row;
--   * when a value first appeared (project_task_rollup's first closed snapshot),
--     which is a run's FIRST row.
-- So: delete the interior of every run of identical rows, and keep it that way
-- with a trigger, which covers every writer (seven functions insert here).

create or replace function project_actuals_drop_repeat() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p1 project_actuals;
  p2 project_actuals;
begin
  select * into p1 from project_actuals
   where project_id is not distinct from new.project_id
     and clickup_task_id is not distinct from new.clickup_task_id
     and id <> new.id
   order by recorded_at desc, id desc limit 1;
  if p1.id is null then return null; end if;

  select * into p2 from project_actuals
   where project_id is not distinct from new.project_id
     and clickup_task_id is not distinct from new.clickup_task_id
     and id <> new.id and id <> p1.id
     and recorded_at <= p1.recorded_at
   order by recorded_at desc, id desc limit 1;
  if p2.id is null then return null; end if;

  -- p1 sits between p2 and the new row; drop it only when all three agree.
  if row(p1.dept_id, p1.planned_hours, p1.actual_hours, p1.status_at_sync, p1.task_name,
         p1.date_closed, p1.points, p1.cost_cents, p1.time_entries, p1.is_productized)
     is not distinct from
     row(new.dept_id, new.planned_hours, new.actual_hours, new.status_at_sync, new.task_name,
         new.date_closed, new.points, new.cost_cents, new.time_entries, new.is_productized)
   and row(p2.dept_id, p2.planned_hours, p2.actual_hours, p2.status_at_sync, p2.task_name,
         p2.date_closed, p2.points, p2.cost_cents, p2.time_entries, p2.is_productized)
     is not distinct from
     row(p1.dept_id, p1.planned_hours, p1.actual_hours, p1.status_at_sync, p1.task_name,
         p1.date_closed, p1.points, p1.cost_cents, p1.time_entries, p1.is_productized)
  then
    delete from project_actuals where id = p1.id;
  end if;
  return null;
end;
$$;

drop trigger if exists project_actuals_drop_repeat on project_actuals;
create trigger project_actuals_drop_repeat
  after insert on project_actuals
  for each row execute function project_actuals_drop_repeat();

-- One-off: the interior of every existing run.
with x as (
  select id,
    (row(dept_id, planned_hours, actual_hours, status_at_sync, task_name, date_closed, points, cost_cents, time_entries, is_productized)
       is not distinct from lag(row(dept_id, planned_hours, actual_hours, status_at_sync, task_name, date_closed, points, cost_cents, time_entries, is_productized)) over w) as same_prev,
    (row(dept_id, planned_hours, actual_hours, status_at_sync, task_name, date_closed, points, cost_cents, time_entries, is_productized)
       is not distinct from lead(row(dept_id, planned_hours, actual_hours, status_at_sync, task_name, date_closed, points, cost_cents, time_entries, is_productized)) over w) as same_next
  from project_actuals
  window w as (partition by project_id, clickup_task_id order by recorded_at, id)
)
delete from project_actuals pa
using x
where pa.id = x.id and x.same_prev and x.same_next;
