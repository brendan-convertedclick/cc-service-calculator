-- 0214_brief_hours_from_time_entries.sql
-- Apply via the Management API query endpoint (name: brief_hours_from_time_entries)
--
-- Lisa, 2026-11-13: ad hoc lines were invoicing short. briefs.actual_hours
-- was ClickUp's task time_spent, read one task at a time by a rotation that
-- reaches each of ~1,200 open briefs every few days (933 had not been read in
-- two days), so a task closed today kept whatever it had when it was last
-- read: 174 briefs sat below the time logged against them, one by 1.97h.
--
-- The sync already pulls every time entry in a 21-day window each half hour,
-- so the hours now come from those. Two figures, one answer:
--   clickup_time_spent_hours  ClickUp's own total, as last read (the old value)
--   actual_hours              the higher of that and the sum of every entry
-- Higher, not entries alone: entries can be incomplete (2 briefs have more in
-- ClickUp than in the table, e.g. time from someone with no ClickUp id here).
-- Recomputed from ALL of a task's entries on every change, never added to a
-- running total, so an edited or deleted entry is picked up.

alter table briefs add column if not exists clickup_time_spent_hours numeric(8,2);
create index if not exists briefs_clickup_task_id_idx on briefs (clickup_task_id);

update briefs set clickup_time_spent_hours = actual_hours
where clickup_time_spent_hours is null and actual_hours is not null;

-- 15 minutes to a point, as POINT_TO_MIN in _shared/clickup.ts.
create or replace function refresh_brief_hours(p_task_id text)
returns void
language sql
security definer
set search_path = public
as $$
  with logged as (
    select coalesce(sum(duration_ms), 0) / 3600000.0 as h
    from clickup_time_entries where clickup_task_id = p_task_id
  )
  update briefs b
     set actual_hours = round(greatest(logged.h, coalesce(b.clickup_time_spent_hours, 0))::numeric, 2),
         actual_points = round((greatest(logged.h, coalesce(b.clickup_time_spent_hours, 0)) * 4)::numeric, 2)
    from logged
   where b.clickup_task_id = p_task_id
     and b.actual_hours is distinct from round(greatest(logged.h, coalesce(b.clickup_time_spent_hours, 0))::numeric, 2);
$$;
revoke execute on function refresh_brief_hours(text) from public, anon, authenticated;

create or replace function clickup_time_entries_refresh_brief()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' and old.clickup_task_id is not null then
    perform refresh_brief_hours(old.clickup_task_id);
  end if;
  if tg_op <> 'DELETE' and new.clickup_task_id is not null
     and (tg_op = 'INSERT' or new.clickup_task_id is distinct from old.clickup_task_id or new.duration_ms is distinct from old.duration_ms) then
    perform refresh_brief_hours(new.clickup_task_id);
  end if;
  return null;
end;
$$;

-- The sync upserts every entry in its window each tick, so an UPDATE that
-- changes neither the task nor the duration must not touch briefs.
drop trigger if exists clickup_time_entries_refresh_brief_upd on clickup_time_entries;
create trigger clickup_time_entries_refresh_brief_upd
  after update on clickup_time_entries
  for each row
  when (old.duration_ms is distinct from new.duration_ms or old.clickup_task_id is distinct from new.clickup_task_id)
  execute function clickup_time_entries_refresh_brief();
drop trigger if exists clickup_time_entries_refresh_brief_insdel on clickup_time_entries;
create trigger clickup_time_entries_refresh_brief_insdel
  after insert or delete on clickup_time_entries
  for each row execute function clickup_time_entries_refresh_brief();

-- And when ClickUp's own figure arrives, the brief takes the higher of the two.
create or replace function briefs_hours_from_clickup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  logged numeric;
begin
  select coalesce(sum(duration_ms), 0) / 3600000.0 into logged
  from clickup_time_entries where clickup_task_id = new.clickup_task_id;
  new.actual_hours := round(greatest(logged, coalesce(new.clickup_time_spent_hours, 0)), 2);
  new.actual_points := round(greatest(logged, coalesce(new.clickup_time_spent_hours, 0)) * 4, 2);
  return new;
end;
$$;
drop trigger if exists briefs_hours_from_clickup on briefs;
create trigger briefs_hours_from_clickup
  before update of clickup_time_spent_hours on briefs
  for each row
  when (new.clickup_task_id is not null and new.clickup_time_spent_hours is distinct from old.clickup_time_spent_hours)
  execute function briefs_hours_from_clickup();

-- Backfill: every brief with entries takes the higher figure now.
with logged as (
  select clickup_task_id, sum(duration_ms) / 3600000.0 as h
  from clickup_time_entries where clickup_task_id is not null group by 1
)
update briefs b
   set actual_hours = round(greatest(l.h, coalesce(b.clickup_time_spent_hours, 0))::numeric, 2),
       actual_points = round((greatest(l.h, coalesce(b.clickup_time_spent_hours, 0)) * 4)::numeric, 2)
  from logged l
 where b.clickup_task_id = l.clickup_task_id
   and b.actual_hours is distinct from round(greatest(l.h, coalesce(b.clickup_time_spent_hours, 0))::numeric, 2);
