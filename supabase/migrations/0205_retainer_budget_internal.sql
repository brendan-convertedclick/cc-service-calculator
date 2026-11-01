-- 0205_retainer_budget_internal.sql
-- Apply via the Management API query endpoint (name: retainer_budget_internal)
--
-- The retainer book keeps client and internal work apart. 0203 admitted every
-- in-progress retainer with a budget, so internal "retainers" (Internal
-- Meetings at 32h, Converted Click Admin, internal Social Media) sat in the
-- Budget tab's "N retainers short by Σh" headline next to client retainers.
-- Same signature and body as 0203, plus one condition in `proj`.
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
  task_proj as (
    select clickup_task_id as task_id, book_project as project_id from bm where clickup_task_id is not null and books
    union all
    select r.clickup_task_id, r.project_id from retainer_recurring_delivery r
    where r.clickup_task_id is not null
      and not exists (select 1 from bm where bm.clickup_task_id = r.clickup_task_id and bm.books)
    union all
    select o.clickup_task_id, o.project_id from ongoing_tasks o
    where o.archived_at is null and o.clickup_task_id is not null and o.project_id in (select id from own)
      and not exists (select 1 from bm where bm.clickup_task_id = o.clickup_task_id and bm.books)
      and not exists (select 1 from retainer_recurring_delivery r where r.clickup_task_id = o.clickup_task_id)
  ),
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
