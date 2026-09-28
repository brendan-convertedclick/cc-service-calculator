-- 0181_replan_keeps_linked_tasks.sql
--
-- Review finding (feat/results-month, pipeline tasks as plans): replan_school_year
-- deletes every FUTURE, untouched, template-sourced task ahead of a re-run
-- planning session (0151 D9's own comment: "a task somebody moved survives
-- the delete"). A task nobody moved but that IS linked to a results row
-- (results_task_links, 0180) survives by month_no just as well as a moved
-- one — cascading that delete silently drops the results_task_links row
-- (on delete cascade, school_task_id) and the results board loses a linked
-- plan nobody touched to lose it. This is not a hypothetical: linking a task
-- and then re-running planning is exactly the sequence the feature invites.
--
-- Copied verbatim from the LIVE definition (`select pg_get_functiondef(
-- 'public.replan_school_year'::regproc)`), not from 0151's file, in case a
-- later migration had already changed it (it had not, but the rule stands).
-- The only change is one added predicate on the delete.

create or replace function public.replan_school_year(p_year_id uuid, p_open_days date[], p_answers jsonb, p_months jsonb, p_tasks jsonb)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_current int;
begin
  select min(month_no) into v_current from school_year_months
   where year_id = p_year_id and closed_at is null;
  if v_current is null then
    raise exception 'replan_school_year: this year is finished';
  end if;

  update school_years
     set open_days = p_open_days, planning_answers = p_answers
   where id = p_year_id;

  update school_year_months m
     set theme = x.theme, role = x.role
    from (select (e->>'month_no')::int as month_no, e->>'theme' as theme, e->>'role' as role
            from jsonb_array_elements(p_months) e) x
   where m.year_id = p_year_id and m.month_no = x.month_no and m.month_no > v_current;

  delete from school_tasks
   where year_id = p_year_id and month_no > v_current
     and state = 'planned' and source = 'template' and moved_at is null
     -- A task linked into Year results (0180) is spoken for even though
     -- nobody moved it — the same reason a moved task survives this delete.
     and not exists (select 1 from results_task_links l where l.school_task_id = school_tasks.id);

  -- D9: a task somebody moved (moved_at is not null) survives the delete
  -- above, so re-inserting the template's full derived list without this
  -- guard duplicates it into both its old and new month. home_month_no is
  -- stable across a move, so the surviving row's own home_month_no is what
  -- suppresses its re-seed.
  insert into school_tasks
    (year_id, month_no, home_month_no, label, side, department_id, est_hours, source, service_id, ordinal, is_gate)
  select p_year_id, (t->>'month_no')::int, (t->>'month_no')::int, t->>'label', t->>'side',
         nullif(t->>'department_id','')::uuid, (t->>'est_hours')::numeric,
         'template', null, coalesce((t->>'ordinal')::int, 0), coalesce((t->>'is_gate')::boolean, false)
    from jsonb_array_elements(p_tasks) t
   where (t->>'month_no')::int > v_current
     and not exists (
       select 1 from school_tasks s
        where s.year_id = p_year_id and s.source = 'template'
          and s.home_month_no = (t->>'month_no')::int
          and s.label = t->>'label'
     );
end;
$function$
;
