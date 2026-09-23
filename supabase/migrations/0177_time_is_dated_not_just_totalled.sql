-- Tracked time, with the date it was tracked on (Lisa, 2026-09-23).
--
-- The capacity page could only ever say "time logged on tasks that CLOSED in
-- this period". Everything a person spent on work still in flight was invisible:
-- Sithembile had 19.6 tracked hours sitting on 9 open tasks, more than her whole
-- week read as. Points cannot fix that, because a point is an allocation on the
-- whole task and there is no such thing as three of eight points happening on a
-- Tuesday. Time can, because every ClickUp time entry carries a start.
--
-- Conductor already held dated entries in two places (ongoing_actuals,
-- project_actuals) and neither covers briefs: of 609 brief tasks since August,
-- one appears in project_actuals, while 268 of them carry tracked hours. So the
-- fact existed in ClickUp and nowhere here.
--
-- One row per ClickUp INTERVAL, keyed on ClickUp's own interval id, which is
-- what makes the sync a plain upsert with no dedup logic to get wrong. It is a
-- cache of ClickUp, not a source of truth: dropping it and re-syncing loses
-- nothing.
create table if not exists clickup_time_entries (
  id              text primary key,
  clickup_task_id text,
  task_name       text,
  clickup_user_id bigint not null,
  started_at      timestamptz not null,
  duration_ms     bigint not null,
  billable        boolean not null default false,
  synced_at       timestamptz not null default now()
);

create index if not exists clickup_time_entries_user_started_idx
  on clickup_time_entries (clickup_user_id, started_at);
create index if not exists clickup_time_entries_task_idx
  on clickup_time_entries (clickup_task_id);

alter table clickup_time_entries enable row level security;

-- Read-only to the app. Every write comes from sync-clickup-actuals on the
-- service role, which bypasses RLS: a person editing their own tracked time
-- here would be editing a cache, and ClickUp would overwrite it on the next
-- tick.
drop policy if exists clickup_time_entries_read on clickup_time_entries;
create policy clickup_time_entries_read on clickup_time_entries
  for select to authenticated using (true);

-- Summed in Postgres, not in the browser. A month is tens of thousands of
-- intervals and the page wants one number per person; shipping the rows over
-- the wire to add them up is the same mistake as counting points client-side.
--
-- Half-open [p_start, p_end) on instants, the same bounds every other query on
-- the capacity page uses (see @/lib/capacity-period) — a bare date would be
-- read as UTC midnight and move every entry before 02:00 SAST into the day
-- before.
create or replace function tracked_hours_by_user(p_start timestamptz, p_end timestamptz)
returns table (clickup_user_id bigint, hours numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select e.clickup_user_id,
         round(sum(e.duration_ms)::numeric / 3600000, 2) as hours
  from clickup_time_entries e
  where e.started_at >= p_start
    and e.started_at <  p_end
    -- A running timer reports a negative duration until it is stopped.
    and e.duration_ms > 0
  group by e.clickup_user_id
$$;

grant execute on function tracked_hours_by_user(timestamptz, timestamptz) to authenticated;
