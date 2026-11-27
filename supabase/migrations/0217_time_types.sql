-- 0217_time_types.sql
-- Apply via the Management API query endpoint (name: time_types)
--
-- Meetings, Admin or Delivery (Lisa, 2026-11-16): where the team's logged
-- time goes, so admin, which nobody can bill, can be seen, cut and modelled.
-- A type belongs to a ClickUp TASK, not to an entry: a perpetual bucket
-- ("[Ongoing] Admin") is one task, so a type set on it holds for all its
-- future time with nothing else to store.
--
-- Anything no rule can place is Unclassified, never Delivery by default:
-- defaulting would hide exactly the admin this exists to show.

-- The list an entry's task sits in, for the "client delivery list" rule.
alter table clickup_time_entries add column if not exists clickup_list_id text;
alter table clickup_time_entries_removed add column if not exists clickup_list_id text;

-- A type somebody chose by hand. Wins over every rule.
create table if not exists task_time_types (
  clickup_task_id text primary key,
  time_type text not null check (time_type in ('meetings', 'admin', 'delivery')),
  set_by uuid references team_members (id) on delete set null,
  set_at timestamptz not null default now()
);
alter table task_time_types enable row level security;
create policy task_time_types_read on task_time_types for select to authenticated using (true);
create policy task_time_types_write on task_time_types for all to authenticated
  using (current_team_member_role() in ('admin', 'owner'))
  with check (current_team_member_role() in ('admin', 'owner'));

-- Every task that has logged time, with its type and the rule that gave it.
-- Rules in order, first match wins (agreed with Lisa 2026-11-16):
--   override  set by hand
--   meeting   created in Conductor as a meeting
--   meeting   whole-word meeting words in the name
--   delivery  Development / Build / Design / Mockup / Render in the name. Before
--             the bucket category, because every adopted bucket defaulted to
--             "Admin / Comms", development ones included.
--   category  the ongoing bucket's time category
--   admin     admin words in the name
--   delivery  a brief or a standing retainer task behind it
--   delivery  sits in a client list grouped as Delivery, no brief
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
delivery_lists as (
  select cl.clickup_list_id from client_lists cl join task_groups tg on tg.id = cl.group_id
  where tg.label_key = 'delivery' and cl.archived_at is null
),
r as (
  select t.clickup_task_id, t.task_name, lower(coalesce(t.task_name, '')) as n,
         o.time_type as manual, cat.t as category,
         t.clickup_task_id in (select clickup_task_id from mtg) as is_meeting,
         t.clickup_task_id in (select clickup_task_id from work) as has_work,
         t.clickup_list_id in (select clickup_list_id from delivery_lists) as in_delivery_list
  from tasks t
  left join task_time_types o on o.clickup_task_id = t.clickup_task_id
  left join cat on cat.clickup_task_id = t.clickup_task_id
)
select clickup_task_id, task_name,
  coalesce(
    manual,
    case
      when is_meeting then 'meetings'
      when n ~ '\[meeting\]|\mstand.?ups?\M|\mstatus meetings?\M|\mmonday status\M|\mmeetings?\M|\mcalls?\M|\m1:1\M|\mcatch.?ups?\M|\mcheck.?ins?\M|\mretros?\M|\mhuddles?\M|\mkick.?offs?\M' then 'meetings'
      when n ~ 'development|\mbuild|\mrender|\mmockup|\mdesign' then 'delivery'
      when category is not null then category
      when n ~ '\madmin|\me-?mails?\M|\mtimesheets?\M|\mplanning\M|\mbriefing\M|\mproject management\M|\minbox\M|\minvoic|\mfinance\M|\mscheduling\M|\mprocedures?\M' then 'admin'
      when has_work then 'delivery'
      when in_delivery_list then 'delivery'
      else 'unclassified'
    end) as time_type,
  case
    when manual is not null then 'set by hand'
    when is_meeting then 'Conductor meeting'
    when n ~ '\[meeting\]|\mstand.?ups?\M|\mstatus meetings?\M|\mmonday status\M|\mmeetings?\M|\mcalls?\M|\m1:1\M|\mcatch.?ups?\M|\mcheck.?ins?\M|\mretros?\M|\mhuddles?\M|\mkick.?offs?\M' then 'meeting word in the name'
    when n ~ 'development|\mbuild|\mrender|\mmockup|\mdesign' then 'delivery word in the name'
    when category is not null then 'bucket category'
    when n ~ '\madmin|\me-?mails?\M|\mtimesheets?\M|\mplanning\M|\mbriefing\M|\mproject management\M|\minbox\M|\minvoic|\mfinance\M|\mscheduling\M|\mprocedures?\M' then 'admin word in the name'
    when has_work then 'brief or standing task'
    when in_delivery_list then 'client delivery list'
    else 'no rule'
  end as rule
from r;

grant select on task_time_types_resolved to authenticated;

-- Logged hours per task per SAST month with their type. The per-person grain
-- is for Brendan and Lisa only (Lisa, 2026-11-16), and the check is here rather
-- than in the page so switching the team view on later cannot leak it.
create or replace function time_type_hours(p_start timestamptz, p_end timestamptz, p_by_person boolean default false)
returns table (clickup_task_id text, task_name text, month text, time_type text, rule text, clickup_user_id bigint, hours numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_by_person and coalesce(current_team_member_role(), '') not in ('admin', 'owner') then
    raise exception 'admin or owner role required for the per-person view';
  end if;
  return query
  select e.clickup_task_id, t.task_name,
         to_char(e.started_at at time zone 'Africa/Johannesburg', 'YYYY-MM'),
         coalesce(t.time_type, 'unclassified'), coalesce(t.rule, 'no rule'),
         case when p_by_person then e.clickup_user_id::bigint end,
         round(sum(e.duration_ms)::numeric / 3600000, 2)
  from clickup_time_entries e
  left join task_time_types_resolved t on t.clickup_task_id = e.clickup_task_id
  where e.clickup_task_id is not null
    and e.started_at >= p_start and e.started_at < p_end
    and e.duration_ms > 0
  group by 1, 2, 3, 4, 5, 6
  -- Paged by the caller: PostgREST stops at 1,000 rows without saying so.
  order by 1, 3, 6;
end $$;

revoke execute on function time_type_hours(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function time_type_hours(timestamptz, timestamptz, boolean) to authenticated;

-- Lisa's mapping of the first unclassified list (2026-11-16): the Sales
-- buckets and the ClickUp-native tasks are Delivery, Client Communication is
-- Admin.
insert into task_time_types (clickup_task_id, time_type, set_by) values
  ('869f4k5vc', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869f50vxm', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869faw0t1', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869ezmc4p', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869ezmc4z', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869fg9eka', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869f0t9ry', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869fhck4b', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869fk34zn', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869fd1j7k', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869fbt0ch', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869fkf0we', 'delivery', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6'),
  ('869fmkj3m', 'admin', 'e55a5b60-070e-4d92-a25c-c66d9ddeace6')
on conflict (clickup_task_id) do nothing;
