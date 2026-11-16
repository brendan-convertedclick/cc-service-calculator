-- 0219_outside_clickup_only.sql
-- Apply via the Management API query endpoint (name: outside_clickup_only)
--
-- Lisa, 2026-11-16: time on a retainer client's ClickUp task that Conductor
-- has no brief, meeting or bucket for was invisible on the Outside tab, which
-- only knew tasks through those records. It now reads the client off the list
-- the task sits in (clickup_time_entries.clickup_list_id, 0217) and reports it
-- as reason 'clickup_only'. There is nothing to book it through, so the row can
-- only be confirmed internal or marked as sales; the fix for real client work
-- is a brief.
--
-- Same body as 0213 plus that one source.

drop function if exists retainer_outside_work(text);
create or replace function retainer_outside_work(p_month text)
returns table (
  client_id uuid, client_name text, clickup_task_id text, task_name text,
  reason text, hours numeric,
  brief_id uuid, brief_billing_type text, meeting_id uuid, ongoing_task_id uuid,
  dismissed_at timestamptz, dismissed_by_name text, dismissed_kind text
)
language sql
stable
security definer
set search_path = public
as $$
  with
  win as (
    select ((p_month || '-01')::timestamp at time zone 'Africa/Johannesburg') as s,
           (((p_month || '-01')::date + interval '1 month')::timestamp at time zone 'Africa/Johannesburg') as e
  ),
  -- The clients the book calls retainer clients (retainer_budget's proj, without the budget filter).
  rc as (
    select distinct p.client_id from projects p join clients c on c.id = p.client_id
    where p.engagement_type = 'retainer' and p.status = 'in_progress' and not coalesce(c.is_internal, false)
  ),
  -- Trellidor's Adhoc Retainer shape: no fee, no hours target, invoiced for
  -- whatever the month held. Work booked there is billed, not hidden.
  open_ret as (
    select id from projects
    where engagement_type = 'retainer' and retainer_monthly_fee_cents is null and retainer_hours_target is null
  ),
  t as (
    select e.clickup_task_id, max(e.task_name) as task_name, sum(e.duration_ms) / 3600000.0 as h
    from clickup_time_entries e, win
    where e.started_at >= win.s and e.started_at < win.e and e.duration_ms > 0 and e.clickup_task_id is not null
    group by 1
  ),
  -- Who a task is for, and what it is. A brief wins, then a meeting, then a bucket.
  src as (
    select distinct on (clickup_task_id) * from (
      select b.clickup_task_id, b.client_id, 1 as pri,
             case when b.status::text = 'archived' then 'archived'
                  when b.billing_type::text = 'adhoc' then 'adhoc'
                  -- Trellidor's Adhoc Retainer shape: a retainer with no fee and
                  -- no hours target, invoiced for whatever the month held. Billed,
                  -- so not hidden, but not against any budget either.
                  when b.parent_project_id in (select id from open_ret) then 'open_retainer'
                  when b.billing_type::text = 'internal' then 'internal'
                  else 'unlinked' end as reason,
             b.id as brief_id, b.billing_type::text as brief_billing_type, null::uuid as meeting_id, null::uuid as ongoing_task_id
      from briefs b where b.clickup_task_id is not null and b.client_id is not null
      union all
      select m.clickup_task_id, m.client_id, 2, case when m.project_id in (select id from open_ret) then 'open_retainer' else 'meeting' end, null, null, m.id, null
      from internal_meetings m
      where m.clickup_task_id is not null and m.client_id is not null and coalesce(m.work_stream_override, '') <> 'New Business'
      union all
      select it.clickup_task_id, m.client_id, 2, case when m.project_id in (select id from open_ret) then 'open_retainer' else 'meeting' end, null, null, m.id, null
      from internal_meeting_tasks it join internal_meetings m on m.id = it.meeting_id
      where it.clickup_task_id is not null and m.client_id is not null and coalesce(m.work_stream_override, '') <> 'New Business'
      union all
      select o.clickup_task_id, o.client_id, 3, case when o.project_id in (select id from open_ret) then 'open_retainer' else 'ongoing' end, null, null, null, o.id
      from ongoing_tasks o where o.clickup_task_id is not null and o.client_id is not null
      union all
      -- A task made in ClickUp with no Conductor record: whose it is comes
      -- from the client list it sits in. Last, so any record above wins.
      select l.clickup_task_id, cl.client_id, 4, 'clickup_only', null, null, null, null
      from (select clickup_task_id, (array_agg(clickup_list_id order by started_at desc)
              filter (where clickup_list_id is not null))[1] as list_id
            from clickup_time_entries where clickup_task_id is not null group by 1) l
      join (select distinct on (clickup_list_id) clickup_list_id, client_id from client_lists
            order by clickup_list_id, archived_at nulls first) cl on cl.clickup_list_id = l.list_id
    ) x
    order by clickup_task_id, pri, brief_id desc nulls last
  )
  select s.client_id, c.name, t.clickup_task_id, t.task_name, s.reason, round(t.h::numeric, 2),
         s.brief_id, s.brief_billing_type, s.meeting_id, s.ongoing_task_id,
         d.dismissed_at, coalesce(tm.full_name, d.dismissed_by_email), d.kind
  from t
  join src s on s.clickup_task_id = t.clickup_task_id
  join clients c on c.id = s.client_id
  left join retainer_outside_dismissals d on d.clickup_task_id = t.clickup_task_id
  left join team_members tm on tm.id = d.dismissed_by
  where s.client_id in (select client_id from rc)
    and t.task_name !~* '\[Ongoing\] Sales'
    and not exists (
      select 1 from retainer_task_project v
      join projects p on p.id = v.project_id
      where v.task_id = t.clickup_task_id and p.client_id = s.client_id and p.engagement_type = 'retainer'
    )
  order by c.name, t.h desc
$$;

revoke execute on function retainer_outside_work(text) from public, anon;
grant execute on function retainer_outside_work(text) to authenticated;
