-- 0211_retainer_outside_dismissals.sql
-- Apply via the Management API query endpoint (name: retainer_outside_dismissals)
--
-- Lisa, 2026-11-13: some time outside a retainer is genuinely ours (internal
-- process, our own tooling). "Confirm internal" takes a task off the hidden
-- total without pretending it never happened: the row records who and when,
-- the tab still shows "Dismissed: Xh" per client, and Undo deletes the row.
-- Keyed on the ClickUp task, so a dismissal holds across months.

create table if not exists retainer_outside_dismissals (
  clickup_task_id text primary key,
  dismissed_at timestamptz not null default now(),
  -- Stamped server-side, never typed: the shared team@ login has no
  -- team_members row, so its email is kept as well.
  dismissed_by uuid default current_team_member_id() references team_members(id) on delete set null,
  dismissed_by_email text default (auth.jwt() ->> 'email')
);

alter table retainer_outside_dismissals enable row level security;
create policy retainer_outside_dismissals_rw on retainer_outside_dismissals
  for all to authenticated using (true) with check (true);

-- Same body as 0210 plus the dismissal columns. The return type changes, so drop first.
drop function if exists retainer_outside_work(text);
create or replace function retainer_outside_work(p_month text)
returns table (
  client_id uuid, client_name text, clickup_task_id text, task_name text,
  reason text, hours numeric,
  brief_id uuid, brief_billing_type text, meeting_id uuid, ongoing_task_id uuid,
  dismissed_at timestamptz, dismissed_by_name text
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
    ) x
    order by clickup_task_id, pri, brief_id desc nulls last
  )
  select s.client_id, c.name, t.clickup_task_id, t.task_name, s.reason, round(t.h::numeric, 2),
         s.brief_id, s.brief_billing_type, s.meeting_id, s.ongoing_task_id,
         d.dismissed_at, coalesce(tm.full_name, d.dismissed_by_email)
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
