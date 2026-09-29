-- 0190_update_school_task.sql
--
-- The planner card's settings dialog saves through this one call. It edits a
-- school's task, and with p_apply_to_template it also rewrites the template
-- task it came from and every other school's copy, in one transaction.
--
-- Why an RPC and not three browser updates: a school task finds its template
-- task BY LABEL (0183-0185 have no template_task_id). Renaming the school row
-- first and the template second from the browser would leave them unmatched
-- the moment one call failed, and the next year planned from that template
-- would lose its group, row and description.
--
-- SECURITY INVOKER on purpose: the template's own RLS (admin/owner write, 0150)
-- still applies. A staff member asking for the template is refused outright
-- rather than silently updating nothing.
--
-- What spreads to the template and other schools: the title, description,
-- group, row and department. What stays on this school's task only: the
-- assignee and the estimate (each school's people and hours are its own),
-- though the estimate also becomes the template's default. Tasks sitting in
-- a closed month are left alone, because tg_school_tasks_guard refuses any
-- write there.

create or replace function public.update_school_task(
  p_task_id uuid,
  p_label text,
  p_description text,
  p_plan_group text,
  p_plan_row text,
  p_department_id uuid,
  p_assignee_id uuid,
  p_est_hours numeric,
  p_apply_to_template boolean default false
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old_label text;
  v_template  uuid;
  v_label     text := nullif(btrim(p_label), '');
begin
  if v_label is null then
    raise exception 'A task needs a title.';
  end if;

  select t.label, y.template_id into v_old_label, v_template
    from school_tasks t join school_years y on y.id = t.year_id
   where t.id = p_task_id;
  if v_old_label is null then
    raise exception 'That task no longer exists.';
  end if;

  update school_tasks
     set label         = v_label,
         description   = nullif(btrim(p_description), ''),
         plan_group    = nullif(btrim(p_plan_group), ''),
         plan_row      = nullif(btrim(p_plan_row), ''),
         department_id = p_department_id,
         assignee_id   = p_assignee_id,
         est_hours     = p_est_hours
   where id = p_task_id;

  if not p_apply_to_template then
    return;
  end if;

  if coalesce(current_team_member_role(), '') not in ('admin', 'owner') then
    raise exception 'Only an admin or owner can change the template.';
  end if;

  update pipeline_template_tasks p
     set label         = v_label,
         description   = nullif(btrim(p_description), ''),
         plan_group    = nullif(btrim(p_plan_group), ''),
         plan_row      = nullif(btrim(p_plan_row), ''),
         department_id = p_department_id,
         est_hours     = p_est_hours
    from pipeline_template_themes th
   where p.theme_id = th.id
     and th.template_id = v_template
     and p.label = v_old_label;

  update school_tasks t
     set label         = v_label,
         description   = nullif(btrim(p_description), ''),
         plan_group    = nullif(btrim(p_plan_group), ''),
         plan_row      = nullif(btrim(p_plan_row), ''),
         department_id = p_department_id
    from school_years y, school_year_months m
   where t.year_id = y.id
     and y.template_id = v_template
     and t.label = v_old_label
     and t.id <> p_task_id
     and m.year_id = t.year_id and m.month_no = t.month_no
     and m.closed_at is null;
end;
$$;

grant execute on function public.update_school_task(uuid, text, text, text, text, uuid, uuid, numeric, boolean) to authenticated;
