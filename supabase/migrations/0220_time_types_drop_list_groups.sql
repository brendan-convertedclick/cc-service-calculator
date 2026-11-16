-- 0220_time_types_drop_list_groups.sql
-- Apply via the Management API query endpoint (name: time_types_drop_list_groups)
--
-- Lisa, 2026-11-16: the Administration / Meetings client-list rule from 0218
-- is too unreliable to keep (client work sits in those lists: PMax checks,
-- campaign feedback, ad optimisations). The Delivery-list rule from 0217 stays.
-- The tasks it misplaced, and two from the meeting-word rule, are set by hand.
-- [Ongoing] Trellidor - Client Meetings is registered as an adopted bucket on
-- the Trellidor Bi-Weekly Meetings retainer, so its time counts there.

create or replace view task_time_types_resolved
with (security_invoker = true) as
with tasks as (
  select clickup_task_id,
         (array_agg(task_name order by started_at desc))[1] as task_name,
         (array_agg(clickup_list_id order by started_at desc) filter (where clickup_list_id is not null))[1] as clickup_list_id
  from clickup_time_entries
  where clickup_task_id is not null
  group by 1
),
cat as (
  select distinct on (o.clickup_task_id) o.clickup_task_id, case
      when tc.label_key in ('standup', 'internal-meetings', 'client-meeting') then 'meetings'
      when tc.label_key in ('admin-comms', 'client-comms', 'internal-planning', 'account-admin',
                            'client-finance', 'administration-planning', 'administration-requests') then 'admin'
      -- Sales is already its own non-billable bar; Admin stays pure overhead.
      when tc.label_key in ('ad-hoc-requests', 'amends-revisions', 'sales-bd', 'client-sales') then 'delivery'
    end as t
  from ongoing_tasks o join time_categories tc on tc.id = o.time_category_id
  where o.clickup_task_id is not null
),
mtg as (
  select clickup_task_id from internal_meetings where clickup_task_id is not null
  union select clickup_task_id from internal_meeting_tasks where clickup_task_id is not null
),
work as (
  select clickup_task_id from briefs where clickup_task_id is not null
  union select clickup_task_id from retainer_recurring_delivery where clickup_task_id is not null
),
list_type as (
  select distinct cl.clickup_list_id, 'delivery' as t
  from client_lists cl join task_groups tg on tg.id = cl.group_id
  where tg.label_key = 'delivery' and cl.archived_at is null
),
r as (
  select t.clickup_task_id, t.task_name, lower(coalesce(t.task_name, '')) as n,
         o.time_type as manual, cat.t as category, lt.t as list_type,
         t.clickup_task_id in (select clickup_task_id from mtg) as is_meeting,
         t.clickup_task_id in (select clickup_task_id from work) as has_work
  from tasks t
  left join task_time_types o on o.clickup_task_id = t.clickup_task_id
  left join cat on cat.clickup_task_id = t.clickup_task_id
  left join list_type lt on lt.clickup_list_id = t.clickup_list_id
),
m as (
  select r.*,
    n ~ '\m(prep|prepare|preparing|preparation|agenda|agendas)\M' as is_prep,
    n ~ '\m(reports?|presentations?|decks?)\M' as is_deliverable
  from r
)
select clickup_task_id, task_name,
  coalesce(
    manual,
    case
      when is_meeting then 'meetings'
      when is_prep and is_deliverable then 'delivery'
      when is_prep then 'admin'
      when n ~ '\[meeting\]|\mstand.?ups?\M|\mstatus meetings?\M|\mmonday status\M|\mmeetings?\M|\mcalls?\M|\m1:1\M|\mcatch.?ups?\M|\mcheck.?ins?\M|\mretros?\M|\mhuddles?\M|\mkick.?offs?\M' then 'meetings'
      when n ~ 'development|\mbuild|\mrender|\mmockup|\mdesign' then 'delivery'
      when category is not null then category
      when n ~ '\madmin|\me-?mails?\M|\mtimesheets?\M|\mplanning\M|\mbriefing\M|\mproject management\M|\minbox\M|\minvoic|\mfinance\M|\mscheduling\M|\mprocedures?\M' then 'admin'
      when has_work then 'delivery'
      when list_type is not null then list_type
      else 'unclassified'
    end) as time_type,
  case
    when manual is not null then 'set by hand'
    when is_meeting then 'Conductor meeting'
    when is_prep and is_deliverable then 'preparing a report, presentation or deck'
    when is_prep then 'prep or agenda in the name'
    when n ~ '\[meeting\]|\mstand.?ups?\M|\mstatus meetings?\M|\mmonday status\M|\mmeetings?\M|\mcalls?\M|\m1:1\M|\mcatch.?ups?\M|\mcheck.?ins?\M|\mretros?\M|\mhuddles?\M|\mkick.?offs?\M' then 'meeting word in the name'
    when n ~ 'development|\mbuild|\mrender|\mmockup|\mdesign' then 'delivery word in the name'
    when category is not null then 'bucket category'
    when n ~ '\madmin|\me-?mails?\M|\mtimesheets?\M|\mplanning\M|\mbriefing\M|\mproject management\M|\minbox\M|\minvoic|\mfinance\M|\mscheduling\M|\mprocedures?\M' then 'admin word in the name'
    when has_work then 'brief or standing task'
    when list_type = 'delivery' then 'client delivery list'
    else 'no rule'
  end as rule
from m;

grant select on task_time_types_resolved to authenticated;

insert into task_time_types (clickup_task_id, time_type, set_by) values
  ('869fcef6m', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'), -- Kings College PMax weekly check
  ('869fk4kj1', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'), -- A Love Supreme campaign feedback
  ('869fkeyjj', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'), -- Review Honeycomb presentation
  ('869fk34uh', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'), -- Dovetail weekly ad optimisations
  ('869fn54ek', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'), -- Quarterly Meeting Feedback Presentation
  ('869f9d39h', 'admin',    'e55a5b60-070e-4d92-a25c-c66d9ddeace6')  -- Implement New Stand Up
on conflict (clickup_task_id) do update set time_type = excluded.time_type, set_by = excluded.set_by, set_at = now();

insert into ongoing_tasks (team_member_id, time_category_id, clickup_task_id, task_name, client_id, billable, adopted, project_id)
select '09f74d05-5d7a-434f-bd26-14e43c577a07', tc.id, '869d9hp4h', '[Ongoing] Trellidor - Client Meetings',
       '4e549277-8f8d-4daf-9f89-d8bd7111169d', true, true, '6f51bbc7-5b78-4d69-ac9d-88f2d3dc67f0'
from time_categories tc where tc.label_key = 'client-meeting'
  and not exists (select 1 from ongoing_tasks where clickup_task_id = '869d9hp4h' and archived_at is null);
