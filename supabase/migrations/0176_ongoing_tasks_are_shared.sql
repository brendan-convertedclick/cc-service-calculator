-- 0176_ongoing_tasks_are_shared.sql
-- Apply via mcp__cc-supabase__apply_migration (name: ongoing_tasks_are_shared)
--
-- Brendan, 2026-09-23: the planner minted one ClickUp task per person per
-- client per category ("[Ongoing] Lisa Zietsman — The Media Mixology — Sales
-- / BD", and again for Brendan). It now mints ONE task per client per
-- category, named "[Ongoing] {Category}" (the 2026-09-17 naming rule: the
-- list already says which client), with everyone picked as an assignee.
--
-- One ongoing_tasks row per ClickUp task, never one per assignee: the sync,
-- capacity and useSystemOverhead all iterate rows, so N rows on one task
-- would count its hours N times. team_member_id is the nominal owner (the
-- first person picked), the same shape 0174 uses for a shared adopted task.

-- 1. Who logged the time, not who owns the row. live_actuals_by_period
--    (build-live-invoice) takes each hour's department from this column, so
--    on a shared task every hour would otherwise bill as the owner's
--    department. Falls back to the owner when the logger is not a team member.
create or replace view public.actuals_intervals as
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

  select
    'ongoing'::text,
    null::uuid,
    ot.id,
    ot.client_id,
    coalesce(logger.id, ot.team_member_id),
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
  left join public.team_members logger
    on logger.clickup_user_id = (e.value -> 'user' ->> 'id')::bigint
  where ot.archived_at is null;

-- 2. The four defaults a client is scaffolded with, all in Administration:
--    it is the list 37 clients have mapped (the others have 17), and the
--    planner provisions one list per run, so one list means one run.
--    Account Admin and Client Meeting become two of them rather than sitting
--    beside near-duplicates. task_name is snapshotted on ongoing_tasks and
--    nothing keys off label_key (0166), so existing tasks are unaffected.
update public.time_categories
   set label = 'Admin'
 where label_key = 'account-admin';

update public.time_categories tc
   set label = 'Client Meetings',
       group_id = tg.id,
       display_order = 130
  from public.task_groups tg
 where tc.label_key = 'client-meeting'
   and tg.label_key = 'administration';

insert into public.time_categories (label_key, label, description, group_id, billable, display_order)
select v.label_key, v.label, v.description, tg.id, v.billable, v.display_order
  from (values
    ('client-sales',   'Sales',   'Upsell, proposals and renewals for this client', false, 140),
    ('client-finance', 'Finance', 'Invoicing, statements and payment follow-up',    false, 150)
  ) as v(label_key, label, description, billable, display_order)
  join public.task_groups tg on tg.label_key = 'administration'
 where not exists (
   select 1 from public.time_categories tc where tc.label_key = v.label_key
 );
