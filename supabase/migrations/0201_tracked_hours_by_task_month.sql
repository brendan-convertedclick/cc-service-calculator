-- 0201_tracked_hours_by_task_month.sql
-- Apply via mcp__cc-supabase__apply_migration (name: tracked_hours_by_task_month)
--
-- The Retainers Book counted a task only in the month it CLOSED, so a retainer
-- whose work was still open, or ongoing, showed none of the time already spent
-- on it (Lisa, 2026-10-29: "we need to see time tracked in October"). This is
-- the per-task twin of tracked_hours_by_user (0177): time logged inside the
-- window, whatever state its task is in, bucketed by the SAST month it was
-- logged in. Summed here, not in the browser, for the same reason as 0177.
create or replace function tracked_hours_by_task_month(p_start timestamptz, p_end timestamptz)
returns table (clickup_task_id text, month text, hours numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select e.clickup_task_id,
         to_char(e.started_at at time zone 'Africa/Johannesburg', 'YYYY-MM') as month,
         round(sum(e.duration_ms)::numeric / 3600000, 2) as hours
  from clickup_time_entries e
  where e.clickup_task_id is not null
    and e.started_at >= p_start
    and e.started_at <  p_end
    -- A running timer reports a negative duration until it is stopped.
    and e.duration_ms > 0
  group by 1, 2
  -- Ordered so the caller can page it: six months is ~1,500 task-months and
  -- PostgREST stops at 1,000 rows without saying so.
  order by 1, 2
$$;

grant execute on function tracked_hours_by_task_month(timestamptz, timestamptz) to authenticated;
