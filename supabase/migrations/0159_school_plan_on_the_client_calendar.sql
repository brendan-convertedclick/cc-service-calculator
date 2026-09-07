-- 0159_school_plan_on_the_client_calendar.sql
-- Apply via mcp__cc-supabase__apply_migration (name: school_plan_on_the_client_calendar)
--
-- A school's year is a plan the school is part of, so the school can see it.
--
-- Until now only SCHOOL-SIDE work reached them, and only on arrival: month N
-- is scheduled, its school-side tasks mint client_approvals rows, and those
-- appear on the sign-off page. Everything we do for them, and everything they
-- owe us next month, existed only in the planner. The client's calendar could
-- therefore show a month with two chips on it while twelve things were
-- actually happening.
--
-- READ-ONLY, and no new rows. Our work must NOT become client_approvals:
-- school_tasks_approval_side_chk forbids it, an agreement needs agreed_at, and
-- ninety-odd rows in their decision queue is not a plan, it is a wall. The
-- client's page grows one array beside `items` instead — a schedule, which is
-- a thing you look at, not a thing you act on.
--
-- Additive: one function, one view, no data touched. (The two DROPs below only
-- exist because the function gained a parameter after its first apply — a
-- create-or-replace cannot change a signature, and nothing depends on it yet.)

drop view if exists public.client_pipeline_schedule;
drop function if exists public.school_task_due_on(uuid, int, boolean);

-- ===========================================================================
-- 1. The due-date rule, in one place, so a planned month can be plotted
-- ===========================================================================
-- A PLANNED task has no due_date and must not gain one — school_tasks_planned_chk
-- calls that "a promise nobody made" and it is right. But a calendar still has
-- to put it on a square, and the square is knowable: it is the date the month
-- will hand it when the month arrives.
--
-- That maths already existed inside schedule_school_year_month. Copying it into
-- a view would be a second copy of the six-week rule — the exact drift this
-- codebase audits itself for — so it comes OUT of the RPC and both callers
-- read this. Behaviour at the write site is identical to 0151's — the RPC below
-- is a pure extraction; the calendar is the caller that wants the rule without
-- the clamp, which is what the one parameter is for.
--
-- tg_school_tasks_guard is deliberately NOT switched to it: a task DRAGGED into
-- an open_day_before month keeps the month-end date rather than re-deriving the
-- gate, which 0151 records as intended (a move is not an arrival).
create or replace function public.school_task_due_on(
  p_year_id       uuid,
  p_month_no      int,
  p_is_gate       boolean,
  -- Clamping forward is a WRITE rule — "no task is born late" — and it belongs
  -- to the moment a month arrives. A calendar plotting a month that has NOT
  -- arrived must not clamp: both live years were mapped retroactively from
  -- January, so eight months of plan would land on today's square and today's
  -- square would move every morning.
  p_clamp_forward boolean default true
)
returns date
language sql
stable
set search_path to 'public'
as $$
  select case
           when coalesce(p_is_gate, false) and g.gate is not null then g.gate
           -- The honest default: nobody knows which day, so the month is the
           -- deadline.
           when coalesce(p_clamp_forward, true)
             then greatest((m.starts_on + interval '1 month - 1 day')::date, current_date)
           else (m.starts_on + interval '1 month - 1 day')::date
         end
    from public.school_year_months m
    left join lateral (
      -- THE SIX-WEEK RULE, MADE A DATE. Read off role, never off the theme
      -- text. Deliberately NOT clamped forward — a gate that has passed must
      -- read as passed — but clamped to the month's own start, because a gate
      -- cannot fall before the month begins.
      --
      -- greatest() ignores nulls, so the null case is spelled out: with no open
      -- day in the following month there is no gate, and `greatest(null, x)`
      -- would silently answer x.
      select case when min(d) is null then null
                  else greatest(min(d) - 42, m.starts_on) end as gate
        from public.school_years y, unnest(y.open_days) as d
       where y.id = m.year_id
         and m.role = 'open_day_before'
         and d >= (m.starts_on + interval '1 month')::date
         and d <  (m.starts_on + interval '2 months')::date
    ) g on true
   where m.year_id = p_year_id
     and m.month_no = p_month_no;
$$;

comment on function public.school_task_due_on(uuid, int, boolean, boolean) is
  'The date a task in this month falls due: the six-week gate for the gate task of an open_day_before month, otherwise the month end. p_clamp_forward is the write-time rule (no task is born late) and belongs to schedule_school_year_month; a calendar plotting a month that has not arrived passes false, or a year mapped retroactively piles every unstarted month onto today.';

create or replace function public.schedule_school_year_month(p_year_id uuid, p_month_no int)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_month     school_year_months%rowtype;
  v_client_id uuid;
  v_due       date;
  t           record;
  v_approval  uuid;
begin
  select * into v_month from school_year_months
   where year_id = p_year_id and month_no = p_month_no;
  if v_month.id is null then
    raise exception 'schedule_school_year_month: month % of year % not found', p_month_no, p_year_id;
  end if;
  if v_month.closed_at is not null then
    raise exception 'schedule_school_year_month: month % is closed', p_month_no;
  end if;

  select client_id into v_client_id from school_years where id = p_year_id;

  -- state<>'done', not state='planned': tg_school_tasks_guard promotes an
  -- INSERT into the current month to 'scheduled' with a month-end date at write
  -- time (0151 D5), so by the time this runs the row may already be 'scheduled'
  -- with the WRONG date on the gate task. This loop recomputes idempotently.
  for t in
    select * from school_tasks
     where year_id = p_year_id and month_no = p_month_no and state <> 'done'
     order by ordinal, id
  loop
    v_due := school_task_due_on(p_year_id, p_month_no, t.is_gate);

    update school_tasks
       set state = 'scheduled', due_date = v_due
     where id = t.id;

    -- An arriving month is when the school is actually asked. It lands on the
    -- sign-off page they already have; no second list, no email of its own.
    if t.side = 'school' and t.client_approval_id is null then
      insert into client_approvals
        (client_id, item_type, item_id, client_title, ask, due_date,
         owed_by, raised_by, state, created_by)
      values
        (v_client_id, 'brief', t.id, t.label,
         'We need this from you for ' || v_month.theme || ' (month ' || p_month_no || ').',
         v_due, 'client', 'us', 'pending', current_team_member_id())
      returning id into v_approval;

      update school_tasks set client_approval_id = v_approval where id = t.id;
    end if;
  end loop;
end;
$$;

-- ===========================================================================
-- 2. What the school sees of its own year
-- ===========================================================================
-- One row per task the client's calendar should carry, with the two dates that
-- put it on a square:
--
--   shows_on     — its own due_date once the month has arrived; the date the
--                  month WILL give it while it is still planned.
--   completed_at — when it was actually finished. ClickUp's own closing time
--                  when the task was briefed (briefs.completed_at is written
--                  from date_done/date_closed by sync-clickup-actuals), and the
--                  staff tick otherwise. That is the whole reason a past month
--                  reads as history rather than as a list of deadlines.
--
-- ROWS WITH A client_approval_id ARE EXCLUDED. Those already reach the client
-- as `items` on the same payload, and a school-side ask on the calendar twice
-- is worse than one nobody could find.
--
-- NO STAFF IDENTITY. assignee_id, department_id, moved_by, done_by and
-- est_hours are all deliberately absent — the two parties on that page are the
-- school and "Converted Click", and this view is the client's, not the
-- planner's (which reads school_tasks directly and is unaffected).
create or replace view public.client_pipeline_schedule
with (security_invoker = true) as
select
  y.client_id,
  t.id,
  t.label,
  t.side,
  t.month_no,
  m.theme,
  coalesce(t.due_date, public.school_task_due_on(t.year_id, t.month_no, t.is_gate, false)) as shows_on,
  coalesce(b.completed_at, t.done_at) as completed_at
from public.school_tasks t
join public.school_year_months m
  on m.year_id = t.year_id and m.month_no = t.month_no
join public.school_years y on y.id = t.year_id
left join public.briefs b on b.id = t.brief_id
where t.client_approval_id is null;

comment on view public.client_pipeline_schedule is
  'A school''s own year, as the school may see it: one row per pipeline task that is not already a client_approvals ask, with the date it sits on and the date it was finished. Read by the client-review edge function and by the staff preview that mirrors it.';

grant select on public.client_pipeline_schedule to authenticated, service_role;
