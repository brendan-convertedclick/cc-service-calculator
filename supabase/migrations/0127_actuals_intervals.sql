-- 0127 — one interval-level view over every tracked time entry.
--
-- Every hours/cost figure in the app was summing whole *task* rows out of
-- project_actuals_current. Those rows are cumulative snapshots: a task touched
-- yesterday drags its entire July history into a "last 30 days" total. That is
-- why the margin tile and the burn figure read several times high.
--
-- ClickUp's time_entries payload is [{ user, intervals: [{ start, time,
-- billable }] }] — the interval is the atom that carries a date. Explode to it
-- once, here, and every consumer can just filter on entry_start.
--
-- The same payload shape is stored for ongoing (overhead) tasks, so both live
-- in one view with a `source` discriminator: overhead % of tracked time is then
-- one query, not a join of two shapes.

create or replace view public.actuals_intervals as
  -- Client project work
  select
    'project'::text                                            as source,
    pa.project_id,
    null::uuid                                                 as ongoing_task_id,
    p.client_id,
    null::uuid                                                 as team_member_id,
    pa.clickup_task_id,
    pa.task_name,
    (e.value -> 'user' ->> 'id')::bigint                       as clickup_user_id,
    iv.value ->> 'id'                                          as entry_id,
    to_timestamp(((iv.value ->> 'start')::bigint) / 1000.0)    as entry_start,
    ((iv.value ->> 'time')::bigint)::numeric / 3600000.0       as hours,
    coalesce((iv.value ->> 'billable')::boolean, false)        as billable
  from public.project_actuals_current pa
  left join public.projects p on p.id = pa.project_id
  cross join lateral jsonb_array_elements(coalesce(pa.time_entries, '[]'::jsonb)) e(value)
  cross join lateral jsonb_array_elements(coalesce(e.value -> 'intervals', '[]'::jsonb)) iv(value)

  union all

  -- Overhead: standups, admin, learning, sales — the perpetual per-person tasks
  select
    'ongoing'::text,
    null::uuid,
    ot.id,
    ot.client_id,
    ot.team_member_id,
    oa.clickup_task_id,
    null::text,
    (e.value -> 'user' ->> 'id')::bigint,
    iv.value ->> 'id',
    to_timestamp(((iv.value ->> 'start')::bigint) / 1000.0),
    ((iv.value ->> 'time')::bigint)::numeric / 3600000.0,
    coalesce((iv.value ->> 'billable')::boolean, false)
  from (
    select distinct on (ongoing_task_id) ongoing_task_id, clickup_task_id, time_entries
    from public.ongoing_actuals
    order by ongoing_task_id, synced_at desc
  ) oa
  join public.ongoing_tasks ot on ot.id = oa.ongoing_task_id
  cross join lateral jsonb_array_elements(coalesce(oa.time_entries, '[]'::jsonb)) e(value)
  cross join lateral jsonb_array_elements(coalesce(e.value -> 'intervals', '[]'::jsonb)) iv(value)
  where ot.archived_at is null;

comment on view public.actuals_intervals is
  'One row per ClickUp time interval, project and ongoing/overhead alike. entry_start is the only honest date on a time entry — filter periods here, never on the cumulative task snapshot.';

grant select on public.actuals_intervals to authenticated, service_role;

-- 0051 read `start` and `duration` off the top-level time_entries element. That
-- payload nests them one level down under `intervals`, so every column came out
-- null and the view has been returning zero rows — build-live-invoice has been
-- quietly billing nothing. Same columns, same billable filter, correct shape.
create or replace view public.live_actuals_by_period as
  select
    ai.client_id,
    ai.team_member_id,
    tm.primary_department_id as department_id,
    ai.clickup_task_id,
    ot.time_category_id,
    ai.entry_id,
    ai.entry_start,
    ai.hours,
    ai.billable
  from public.actuals_intervals ai
  join public.ongoing_tasks ot on ot.id = ai.ongoing_task_id
  join public.team_members tm on tm.id = ai.team_member_id
  where ai.source = 'ongoing'
    and ai.client_id is not null
    and ai.billable;
