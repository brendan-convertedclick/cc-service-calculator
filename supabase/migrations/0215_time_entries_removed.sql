-- 0215_time_entries_removed.sql
-- Apply via the Management API query endpoint (name: time_entries_removed)
--
-- Lisa, 2026-11-13: an entry ClickUp stops returning is hidden, not destroyed,
-- so one removed by mistake can be put back. The sync moves it here and out of
-- clickup_time_entries, which every reader (and the 0214 hours trigger) sums,
-- so nothing downstream needs to know this table exists. If ClickUp returns
-- the entry again, the sync re-inserts it and deletes it from here.
-- Restore by hand: insert into clickup_time_entries select id, clickup_task_id,
-- task_name, clickup_user_id, started_at, duration_ms, billable, now() from
-- clickup_time_entries_removed where id = '…'; then delete it from here.

create table if not exists clickup_time_entries_removed (
  id text primary key,
  clickup_task_id text,
  task_name text,
  clickup_user_id bigint,
  started_at timestamptz,
  duration_ms bigint,
  billable boolean,
  synced_at timestamptz,
  removed_at timestamptz not null default now(),
  -- Where the row came from: the sync, or rebuilt from a project_actuals
  -- snapshot for the 63 the first run deleted outright.
  source text not null default 'sync'
);
alter table clickup_time_entries_removed enable row level security;
create policy clickup_time_entries_removed_read on clickup_time_entries_removed
  for select to authenticated using (true);
