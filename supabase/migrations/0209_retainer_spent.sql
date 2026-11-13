-- 0209_retainer_spent.sql
-- Apply via the Management API query endpoint (name: retainer_spent)
--
-- retainer_budget returns only retainers with a budget, so a retainer with no
-- fee and no hours target (Kings College TKC Dashboard, billed separately)
-- showed nothing on its project page although 5.2h was tracked against it in
-- November. This is the Spent half on its own, from the same
-- retainer_task_project rule, for one project and one SAST month.
create or replace function retainer_spent(p_project_id uuid, p_month text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(round(sum(e.duration_ms)::numeric / 3600000, 2), 0)
  from clickup_time_entries e
  join (select distinct task_id from retainer_task_project where project_id = p_project_id) v
    on v.task_id = e.clickup_task_id
  where e.duration_ms > 0
    and e.started_at >= ((p_month || '-01')::timestamp at time zone 'Africa/Johannesburg')
    and e.started_at <  (((p_month || '-01')::date + interval '1 month')::timestamp at time zone 'Africa/Johannesburg')
$$;

revoke execute on function retainer_spent(uuid, text) from public, anon;
grant execute on function retainer_spent(uuid, text) to authenticated;
