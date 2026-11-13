-- 0207_retainer_outside_work.sql
-- Apply via mcp__cc-supabase__apply_migration (name: retainer_outside_work)
--
-- Brendan, 2026-11-13: work for a retainer client that never reaches one of
-- its retainers is invisible. Nobody sees it against the budget, nobody bills
-- it, and nobody can tell the client they pushed the retainer over. The
-- Dovetail example was work meetings: they cost time and should sit inside the
-- retainer, but the book did not count a meeting at all, even one booked to a
-- retainer project.
--
-- Three things, so the Outside tab and Spent cannot disagree:
--
-- 1. retainer_task_project is the ONE definition of which retainer a ClickUp
--    task's time lands on. It was a CTE copied into 0204 and again into 0205;
--    a third copy for this tab is how two numbers on one page drift apart.
--    useRetainerAllocation mirrors it in TypeScript and must change with it.
-- 2. It gains a fourth, lowest-precedence leg: a Conductor meeting (or a
--    per-attendee meeting task) books to its meeting's project_id. So Spent
--    rises wherever a meeting is booked to a retainer. That is the point.
-- 3. retainer_outside_work lists, for a SAST month, every task with time for a
--    retainer client that does not land on one of that client's retainers,
--    with the reason why. Sales is excluded: [Ongoing] Sales buckets and
--    meetings on the New Business work stream.
--
-- Not covered: a ClickUp task Conductor has never seen (no brief, meeting or
-- bucket). Its client is only knowable from its ClickUp list, which time
-- entries do not store yet.

create or replace view retainer_task_project as
  with
  own as (
    select id from projects
    where engagement_type in ('retainer', 'fixed') and status <> 'archived'
      and (engagement_type = 'fixed' or retainer_monthly_fee_cents is not null or retainer_hours_target is not null)
  ),
  bm as (
    select b.clickup_task_id, case
        when b.client_id is not null and (b.billing_type = 'internal' or c.is_internal) then null
        when b.parent_project_id in (select id from own) and b.billing_type is distinct from 'adhoc' then b.parent_project_id
      end as book_project,
      (b.client_id is not null or (b.parent_project_id in (select id from own) and b.billing_type is distinct from 'adhoc')) as books
    from briefs b left join clients c on c.id = b.client_id
    where b.status::text in ('briefed','accepted','quoted','scoped') and b.clickup_task_id is not null
  ),
  meet as (
    select m.clickup_task_id, m.project_id from internal_meetings m
    where m.clickup_task_id is not null and m.project_id in (select id from own)
    union
    select it.clickup_task_id, m.project_id from internal_meeting_tasks it
    join internal_meetings m on m.id = it.meeting_id
    where it.clickup_task_id is not null and m.project_id in (select id from own)
  )
  select clickup_task_id as task_id, book_project as project_id from bm where books
  union all
  select r.clickup_task_id, r.project_id from retainer_recurring_delivery r
  where r.clickup_task_id is not null
    and not exists (select 1 from bm where bm.clickup_task_id = r.clickup_task_id and bm.books)
  union all
  select o.clickup_task_id, o.project_id from ongoing_tasks o
  where o.archived_at is null and o.clickup_task_id is not null and o.project_id in (select id from own)
    and not exists (select 1 from bm where bm.clickup_task_id = o.clickup_task_id and bm.books)
    and not exists (select 1 from retainer_recurring_delivery r where r.clickup_task_id = o.clickup_task_id)
  union all
  select mt.clickup_task_id, mt.project_id from meet mt
  where not exists (select 1 from bm where bm.clickup_task_id = mt.clickup_task_id and bm.books)
    and not exists (select 1 from retainer_recurring_delivery r where r.clickup_task_id = mt.clickup_task_id)
    and not exists (select 1 from ongoing_tasks o where o.archived_at is null and o.clickup_task_id = mt.clickup_task_id
                      and o.project_id in (select id from own));

-- Read only through the SECURITY DEFINER functions below. A plain view runs as
-- its owner, so granting it would hand every brief's routing past RLS.
revoke all on retainer_task_project from public, anon, authenticated;

-- retainer_budget: same signature and body as 0205, with task_proj read from
-- the view. Its meeting leg is the only change in what it returns.
create or replace function retainer_budget(p_month text, p_client_id uuid default null)
returns table (
  project_id uuid, project_name text, client_id uuid, client_name text,
  department_id uuid, department_name text,
  budget_hours numeric, alloc_hours numeric, spent_hours numeric, todo_hours numeric,
  unestimated_count int
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
  proj as (
    select p.id, p.name, p.client_id, c.name as client_name,
           coalesce(p.retainer_monthly_fee_cents / 115000.0, p.retainer_hours_target)::numeric as budget
    from projects p join clients c on c.id = p.client_id
    where p.engagement_type = 'retainer' and p.status = 'in_progress'
      and not coalesce(c.is_internal, false)
      and coalesce(p.retainer_monthly_fee_cents / 115000.0, p.retainer_hours_target) > 0
      and (p_client_id is null or p.client_id = p_client_id)
  ),
  -- Projects that carry their own row in the book (hook: projectsWithOwnRow).
  own as (
    select id from projects
    where engagement_type in ('retainer', 'fixed') and status <> 'archived'
      and (engagement_type = 'fixed' or retainer_monthly_fee_cents is not null or retainer_hours_target is not null)
  ),
  -- Where each brief books: a project, or elsewhere (null project, still wins).
  bm as (
    select b.*, case
        when b.client_id is not null and (b.billing_type = 'internal' or c.is_internal) then null
        when b.parent_project_id in (select id from own) and b.billing_type is distinct from 'adhoc' then b.parent_project_id
      end as book_project,
      (b.client_id is not null or (b.parent_project_id in (select id from own) and b.billing_type is distinct from 'adhoc')) as books
    from briefs b left join clients c on c.id = b.client_id
    where b.status::text in ('briefed','accepted','quoted','scoped')
  ),
  task_proj as (select task_id, project_id from retainer_task_project),
  spent as (
    select tp.project_id, tm.primary_department_id as dept,
           sum(x.h) as hrs
    from (
      select e.clickup_task_id, e.clickup_user_id::text as uid,
             round(sum(e.duration_ms)::numeric / 3600000, 2) as h
      from clickup_time_entries e, win
      where e.started_at >= win.s and e.started_at < win.e and e.duration_ms > 0
      group by 1, 2
    ) x
    join (select distinct task_id, project_id from task_proj) tp on tp.task_id = x.clickup_task_id
    left join team_members tm on tm.clickup_user_id::text = x.uid
    where tp.project_id in (select id from proj)
    group by 1, 2
  ),
  alltime as (
    select clickup_task_id, sum(duration_ms) / 3600000.0 as h
    from clickup_time_entries where duration_ms > 0 group by 1
  ),
  todo_b as (
    select bm.book_project as project_id, tm.primary_department_id as dept,
           greatest(0, coalesce(bm.clickup_points, bm.original_points) * 0.25 - coalesce(a.h, 0)) as hrs,
           (bm.clickup_points is null and bm.original_points is null) as unest
    from bm
    left join alltime a on a.clickup_task_id = bm.clickup_task_id
    left join team_members tm on tm.id = bm.assignee_id
    where bm.book_project in (select id from proj)
      and bm.clickup_task_status is distinct from 'closed' and bm.completed_at is null
  ),
  todo_r as (
    select r.project_id,
           (select tm.primary_department_id from provisioned_tasks pt
              join team_members tm on tm.id = pt.assignee_id
             where r.clickup_task_id = any (pt.clickup_task_ids) limit 1) as dept,
           greatest(0, coalesce(r.planned_hours, 0) - coalesce(a.h, 0)) as hrs
    from retainer_recurring_delivery r
    left join alltime a on a.clickup_task_id = r.clickup_task_id
    where r.month = p_month and r.is_closed = false and r.project_id in (select id from proj)
      and not exists (select 1 from bm where bm.clickup_task_id = r.clickup_task_id and bm.books)
  ),
  todo as (
    select project_id, dept, sum(hrs) as hrs from (
      select project_id, dept, hrs from todo_b union all select project_id, dept, hrs from todo_r
    ) t group by 1, 2
  ),
  alloc as (
    select s.project_id, ra.department_id as dept,
           sum(s.points_per_occurrence * s.occurrences_per_month * 0.25 * ra.pct / 100) as hrs
    from retainer_recurring_services s
    join services sv on sv.id = s.service_id
    join rule_allocations ra on ra.rule_id = sv.rule_id
    where s.paused_at is null and s.project_id in (select id from proj)
    group by 1, 2
  ),
  unest as (select project_id, count(*)::int as n from todo_b where unest group by 1),
  keys as (
    select project_id, dept from spent union select project_id, dept from todo union select project_id, dept from alloc
    union select id, null from proj where id not in (
      select project_id from spent union select project_id from todo union select project_id from alloc)
  )
  select p.id, p.name, p.client_id, p.client_name, k.dept, d.name,
         round(p.budget, 2),
         round(coalesce(al.hrs, 0), 2), round(coalesce(sp.hrs, 0), 2), round(coalesce(td.hrs, 0), 2),
         coalesce(u.n, 0)
  from keys k
  join proj p on p.id = k.project_id
  left join departments d on d.id = k.dept
  left join spent sp on sp.project_id = k.project_id and sp.dept is not distinct from k.dept
  left join todo td on td.project_id = k.project_id and td.dept is not distinct from k.dept
  left join alloc al on al.project_id = k.project_id and al.dept is not distinct from k.dept
  left join unest u on u.project_id = k.project_id
  order by p.client_name, p.name, d.name nulls last
$$;

-- Postgres grants EXECUTE to PUBLIC on creation, and the anon key ships in the
-- browser bundle, so without this anyone could read every retainer's budget.
revoke execute on function retainer_budget(text, uuid) from public, anon;
grant execute on function retainer_budget(text, uuid) to authenticated;

create or replace function retainer_outside_work(p_month text)
returns table (
  client_id uuid, client_name text, clickup_task_id text, task_name text,
  reason text, hours numeric,
  brief_id uuid, brief_billing_type text, meeting_id uuid, ongoing_task_id uuid
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
                  when b.billing_type::text = 'internal' then 'internal'
                  else 'unlinked' end as reason,
             b.id as brief_id, b.billing_type::text as brief_billing_type, null::uuid as meeting_id, null::uuid as ongoing_task_id
      from briefs b where b.clickup_task_id is not null and b.client_id is not null
      union all
      select m.clickup_task_id, m.client_id, 2, 'meeting', null, null, m.id, null
      from internal_meetings m
      where m.clickup_task_id is not null and m.client_id is not null and coalesce(m.work_stream_override, '') <> 'New Business'
      union all
      select it.clickup_task_id, m.client_id, 2, 'meeting', null, null, m.id, null
      from internal_meeting_tasks it join internal_meetings m on m.id = it.meeting_id
      where it.clickup_task_id is not null and m.client_id is not null and coalesce(m.work_stream_override, '') <> 'New Business'
      union all
      select o.clickup_task_id, o.client_id, 3, 'ongoing', null, null, null, o.id
      from ongoing_tasks o where o.clickup_task_id is not null and o.client_id is not null
    ) x
    order by clickup_task_id, pri, brief_id desc nulls last
  )
  select s.client_id, c.name, t.clickup_task_id, t.task_name, s.reason, round(t.h::numeric, 2),
         s.brief_id, s.brief_billing_type, s.meeting_id, s.ongoing_task_id
  from t
  join src s on s.clickup_task_id = t.clickup_task_id
  join clients c on c.id = s.client_id
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
