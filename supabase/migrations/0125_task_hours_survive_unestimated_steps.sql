-- 0125_task_hours_survive_unestimated_steps.sql
-- Apply via mcp__cc-supabase__apply_migration (name: task_hours_survive_unestimated_steps)
--
-- The rollup trigger set a task's estimated_hours to SUM(children.estimated_hours)
-- on every step insert/delete/update. Postgres SUM() over all-NULL rows returns
-- NULL, so a task with steps but no per-step hours always got its own
-- manually-entered estimate wiped to NULL. That made "skip step hours, put one
-- number on the task" impossible once the task had any checklist items.
--
-- Now: only overwrite the task's hours when at least one step actually has an
-- hour value. No estimated steps at all -> leave whatever's on the task alone.

create or replace function sync_parent_step_hours()
returns trigger
language plpgsql
as $$
declare
  target uuid := coalesce(new.parent_id, old.parent_id);
  child_sum numeric;
  any_estimated boolean;
begin
  if target is null then
    return coalesce(new, old);
  end if;

  select sum(c.estimated_hours), bool_or(c.estimated_hours is not null)
    into child_sum, any_estimated
    from process_steps c
   where c.parent_id = target;

  if any_estimated then
    update process_steps p set estimated_hours = child_sum where p.id = target;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function sync_parent_step_hours_move()
returns trigger
language plpgsql
as $$
declare
  child_sum numeric;
  any_estimated boolean;
begin
  if old.parent_id is distinct from new.parent_id and old.parent_id is not null then
    select sum(c.estimated_hours), bool_or(c.estimated_hours is not null)
      into child_sum, any_estimated
      from process_steps c
     where c.parent_id = old.parent_id;

    if any_estimated then
      update process_steps p set estimated_hours = child_sum where p.id = old.parent_id;
    end if;
  end if;

  return new;
end;
$$;
