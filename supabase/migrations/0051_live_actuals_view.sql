-- supabase/migrations/0051_live_actuals_view.sql
--
-- live_actuals_by_period — one row per (client × member × billable entry)
-- with the entry's start timestamp exploded out of the time_entries JSON
-- so the invoice builder can filter by period without re-fetching.
--
-- Reads from the latest ongoing_actuals snapshot per task so we never
-- double-count entries that appear across multiple snapshots.

create or replace view public.live_actuals_by_period as
with latest as (
  select distinct on (ongoing_task_id)
    ongoing_task_id,
    time_entries,
    synced_at
  from public.ongoing_actuals
  order by ongoing_task_id, synced_at desc
)
select
  ot.client_id,
  ot.team_member_id,
  tm.primary_department_id    as department_id,
  ot.clickup_task_id,
  ot.time_category_id,
  (e->>'id')                  as entry_id,
  to_timestamp((e->>'start')::bigint / 1000) as entry_start,
  ((e->>'duration')::bigint / 3600000.0)     as hours,
  (e->>'billable')::boolean   as billable
from latest l
join public.ongoing_tasks ot on ot.id = l.ongoing_task_id
join public.team_members tm  on tm.id = ot.team_member_id
cross join lateral jsonb_array_elements(coalesce(l.time_entries, '[]'::jsonb)) as e
where ot.archived_at is null
  and ot.client_id is not null
  and (e->>'billable')::boolean = true;

comment on view public.live_actuals_by_period is
  'Exploded billable time entries from the latest ongoing_actuals snapshot '
  'per task. Filter by entry_start range + client_id to build a period invoice.';
