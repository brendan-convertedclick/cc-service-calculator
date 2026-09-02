-- 0151_pipeline_fixes.sql
-- Apply via mcp__cc-supabase__apply_migration (name: pipeline_fixes)
--
-- Adversarial review of the Pipeline feature (0150) found seven defects, four
-- verified against the live database. Live-data check run before writing this
-- migration: school_years 0, school_year_months 0, school_tasks 0,
-- client_approvals school-linked 0, clients where is_school 0. There is no
-- data to migrate — no back-compat shim, no dual-read.
--
-- This migration covers the DB-side fixes only:
--   D4 — team@ cannot close a month (closed_by NULL violates the check)
--   D5 — an INSERT into the current month must arrive 'scheduled', not
--        'planned' with a null due_date, or it can never be ticked and blocks
--        the month forever
--   D1b — the six-week gate date must apply ONLY to the actual gate task, and
--        must never precede the month it sits in
--   D2 — est_hours seeded on all 66 template tasks (0 school-side, real
--        estimates on our side)
--
-- Note on counts: the design decision this migration implements claims "41
-- ours / 25 school" rows. Reading the actual seed in 0150 section 8 gives 44
-- 'us' rows and 22 'school' rows (44 + 22 = 66, matches the seed's own total).
-- This migration follows the CODE, not the miscounted prose — every 'us' row
-- in the live seed gets an hour value below, every 'school' row gets 0.

-- ===========================================================================
-- D4 — a month close with no attributable closer is a real thing here, not a
-- data-integrity gap. The in-repo precedent is process_step_notes.created_by,
-- nullable for exactly the same reason: team@ resolves current_team_member_id()
-- to null. Keep the half of the biconditional that still means something —
-- a closer implies a close — and drop the half that broke the shared login.
-- ===========================================================================
alter table public.school_year_months
  drop constraint school_year_months_closed_chk;
alter table public.school_year_months
  add constraint school_year_months_closed_chk
  check (closed_by is null or closed_at is not null);

comment on column public.school_year_months.closed_by is
  'Who closed the month, when known. Null on a close from team@ (no team_members row) — closed_at is the fact that matters and is never null on a closed month.';

-- ===========================================================================
-- THE GATE FLAG. Read off a column, not a label string re-typed into plpgsql —
-- the label already exists once (sixWeekBreach in pipeline-year.ts); a second
-- copy here is the drift this codebase audits itself for, and its failure mode
-- is silent (a stale literal just falls back to month-end).
-- ===========================================================================
alter table public.pipeline_template_tasks
  add column if not exists is_gate boolean not null default false;
alter table public.school_tasks
  add column if not exists is_gate boolean not null default false;

comment on column public.pipeline_template_tasks.is_gate is
  'True on exactly one task: the six-week hard deadline in the open_day_before theme ("Creative approved"). Copied onto school_tasks at seed time; schedule_school_year_month reads it to decide which row gets the gate date instead of the month-end date.';
comment on column public.school_tasks.is_gate is
  'Copied from pipeline_template_tasks.is_gate at seed time. The one row per open_day_before month whose due_date is the six-week-before-open-day gate, not the month end.';

update public.pipeline_template_tasks t
   set is_gate = true
  from public.pipeline_template_themes th, public.pipeline_templates tpl
 where t.theme_id = th.id
   and th.template_id = tpl.id
   and tpl.name = 'Schools — 12 month year'
   and th.theme = 'Build the open day machine'
   and t.label = 'Creative approved — the hard deadline';

-- ===========================================================================
-- D2 — HOURS. The rows already exist (est_hours is null on all 66); this is
-- an UPDATE, not a re-seed. School-side = 0 on every row: it is the client's
-- work, and a month header that counts it is counting hours we do not do.
-- ===========================================================================
update public.pipeline_template_tasks t
   set est_hours = v.hours
  from public.pipeline_template_themes th,
       public.pipeline_templates tpl,
       (values
         ('Set the year up','Ultimate guides refreshed',4),
         ('Set the year up','School calendar published',2),
         ('Set the year up','SEO health check, and fix what it finds',6),
         ('Set the year up','Always-on search live',3),
         ('Set the year up','Tracking verified with a live submission',1.5),

         ('Build the open day machine','One creative run covering every open day this year',6),
         ('Build the open day machine','Landing page built and tested',4),
         ('Build the open day machine','Booking forms feeding Granite',2),
         ('Build the open day machine','Emailer and WhatsApp steps built',3),
         ('Build the open day machine','Campaign built in Slate, ready but not live',2),

         ('Open day runs','Campaign goes live',1),
         ('Open day runs','Bookings flowing into the pipeline daily',2),
         ('Open day runs','Follow-up sequence firing automatically',1.5),
         ('Open day runs','Reminder sequence in the final week',1),
         ('Open day runs','Attendance recorded against bookings',1),

         ('Convert the interest','Post-open-day nurture for every booked family',2),
         ('Convert the interest','Application prompts to everyone who attended',1.5),
         ('Convert the interest','Ultimate guide published and flighted',4),
         ('Convert the interest','Reviews requested from attending families',1),
         ('Convert the interest','Pipeline review: who is stuck, and why',1.5),

         ('Build the audience','Prize and follow campaign built and launched',5),
         ('Build the audience','Ultimate guide published and flighted',4),
         ('Build the audience','Reach and follower growth reported',1.5),

         ('Applications and housekeeping','Application support content published',3),
         ('Applications and housekeeping','Mid-year SEO health check',4),
         ('Applications and housekeeping','Pipeline cleanup — stale enquiries reworked',2),
         ('Applications and housekeeping','Half-year review of targets against actuals',2),

         ('Offers go out','Support content for families deciding',3),
         ('Offers go out','Acceptance nurture running',1.5),
         ('Offers go out','Prize campaign concludes and reports',2),
         ('Offers go out','Reviews requested from current parents',1),

         ('Acceptances land','Deposit and acceptance follow-up',1.5),
         ('Acceptances land','Ultimate guide published',4),
         ('Acceptances land','Enrolments recorded and attributed',2),
         ('Acceptances land','The loop closed: enquiry to enrolment, traced',2),

         ('Fill the gaps','Late application push',2),
         ('Fill the gaps','Targeted campaigns for under-filled grades',3),
         ('Fill the gaps','Next year planning begins',2),

         ('Close the year out','Final enrolment push',2),
         ('Close the year out','Full-year results and attribution report',6),
         ('Close the year out','Next year targets agreed and documented',2),

         ('Build the bank','Content produced and banked for next year',6),
         ('Build the bank','Calendar refreshed for the year ahead',2),
         ('Build the bank','Light social only',3)
       ) as v(theme, label, hours)
 where t.theme_id = th.id
   and th.template_id = tpl.id
   and tpl.name = 'Schools — 12 month year'
   and th.theme = v.theme
   and t.label = v.label;

update public.pipeline_template_tasks t
   set est_hours = 0
  from public.pipeline_template_themes th, public.pipeline_templates tpl
 where t.theme_id = th.id
   and th.template_id = tpl.id
   and tpl.name = 'Schools — 12 month year'
   and t.side = 'school';

-- ===========================================================================
-- D1b + D5 — one change, not two. schedule_school_year_month now: (a) applies
-- the six-week gate date ONLY to t.is_gate, every other school-side row gets
-- month-end; (b) clamps the gate so it can never precede the month's own
-- start (still unclamped FORWARD — a gate already passed must read as passed,
-- per 0150's own argument for v_last_day); (c) widens its loop from
-- state='planned' to state<>'done' so it is idempotent over rows the new
-- INSERT-time trigger promotion (below) already touched.
-- ===========================================================================
create or replace function public.schedule_school_year_month(p_year_id uuid, p_month_no int)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_month     school_year_months%rowtype;
  v_client_id uuid;
  v_last_day  date;
  v_open_day  date;
  v_gate      date;
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

  -- The honest default: nobody knows which day, so the month is the deadline.
  -- Clamped forward for a year mapped retroactively, so no task is born late.
  v_last_day := greatest((v_month.starts_on + interval '1 month - 1 day')::date, current_date);

  -- THE SIX-WEEK RULE, MADE A DATE. Read off role, never off the theme text.
  -- Deliberately NOT clamped forward: if that date has passed the run-up is
  -- already compromised and the page must say so. It IS clamped to the
  -- month's own start — a gate can never fall before the month begins.
  if v_month.role = 'open_day_before' then
    select min(d) into v_open_day
      from school_years y, unnest(y.open_days) as d
     where y.id = p_year_id
       and d >= (v_month.starts_on + interval '1 month')::date
       and d <  (v_month.starts_on + interval '2 months')::date;
    if v_open_day is not null then
      v_gate := greatest(v_open_day - 42, v_month.starts_on);
    end if;
  end if;

  -- state<>'done', not state='planned': tg_school_tasks_guard now promotes an
  -- INSERT into the current month to 'scheduled' with a month-end date at
  -- write time (D5), so by the time this runs the row may already be
  -- 'scheduled' with the WRONG date (month-end on the gate task). This loop
  -- is the one place that knows is_gate, so it recomputes idempotently.
  for t in
    select * from school_tasks
     where year_id = p_year_id and month_no = p_month_no and state <> 'done'
     order by ordinal, id
  loop
    update school_tasks
       set state    = 'scheduled',
           due_date = case when t.is_gate and v_gate is not null then v_gate else v_last_day end
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
         case when t.is_gate and v_gate is not null then v_gate else v_last_day end,
         'client', 'us', 'pending', current_team_member_id())
      returning id into v_approval;

      update school_tasks set client_approval_id = v_approval where id = t.id;
    end if;
  end loop;
end;
$$;

-- ===========================================================================
-- D5 — an INSERT into the school's CURRENT month must land 'scheduled' with a
-- date, not 'planned' with a null due_date: school_tasks_planned_chk forbids
-- ticking a 'planned' row, and close_school_year_month counts an untickable
-- 'planned' row as not-done forever. Fixed in the trigger so every insert
-- path is covered (useAddServiceToMonth's hook included), not just one.
--
-- This also means create_school_year's own bulk INSERT of month-1 tasks gets
-- promoted here before schedule_school_year_month(year, 1) ever runs — which
-- is exactly why that function's loop above was widened to state<>'done'.
-- ===========================================================================
create or replace function public.tg_school_tasks_guard()
returns trigger
language plpgsql
as $$
declare
  v_closed  timestamptz;
  v_current int;
  v_starts  date;
begin
  if tg_op = 'DELETE' then
    select closed_at into v_closed from public.school_year_months
     where year_id = old.year_id and month_no = old.month_no;
    if v_closed is not null then
      raise exception 'school_tasks: month % of this year is closed — reopen it before removing work from it', old.month_no;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.month_no is distinct from new.month_no then
    -- Done work is a record of what happened in a month. It does not move.
    if old.state = 'done' then
      raise exception 'school_tasks: completed work does not move';
    end if;
    select closed_at into v_closed from public.school_year_months
     where year_id = old.year_id and month_no = old.month_no;
    if v_closed is not null then
      raise exception 'school_tasks: month % is closed — work cannot be moved out of it', old.month_no;
    end if;
    new.moved_at := now();
    new.moved_by := public.current_team_member_id();
  end if;

  select closed_at, starts_on into v_closed, v_starts
    from public.school_year_months
   where year_id = new.year_id and month_no = new.month_no;
  if v_closed is not null then
    raise exception 'school_tasks: month % is closed — work cannot be scheduled into it', new.month_no;
  end if;

  -- STATE FOLLOWS THE COLUMN, and the column is the only thing anyone edits.
  -- A task moved into the month the school is actually in has arrived and gets
  -- a date; one moved out of it is a plan again and loses the date it never
  -- earned.
  if tg_op = 'UPDATE' and old.month_no is distinct from new.month_no then
    select min(month_no) into v_current from public.school_year_months
     where year_id = new.year_id and closed_at is null;
    if new.month_no = v_current then
      new.state := 'scheduled';
      if new.due_date is null then
        new.due_date := greatest((v_starts + interval '1 month - 1 day')::date, current_date);
      end if;
    else
      new.state    := 'planned';
      new.due_date := null;
    end if;
  end if;

  if tg_op = 'INSERT' and new.home_month_no is null then
    new.home_month_no := new.month_no;
  end if;

  -- D5: a fresh row born directly into the school's current month has
  -- arrived too — the same rule as a move, applied to an insert. Every other
  -- insert path (a future month, a school not yet in its current month at
  -- this point of a bulk seed) is untouched: it stays 'planned'/null exactly
  -- as the caller wrote it.
  if tg_op = 'INSERT' and new.state = 'planned' then
    select min(month_no) into v_current from public.school_year_months
     where year_id = new.year_id and closed_at is null;
    if new.month_no = v_current then
      new.state := 'scheduled';
      if new.due_date is null then
        new.due_date := greatest((v_starts + interval '1 month - 1 day')::date, current_date);
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ponytail: a school-side task dragged into an open_day_before month keeps the
-- month-end date rather than re-deriving the six-week gate, and no
-- client_approvals row is minted by a move — only by arrival. Unchanged from
-- 0150's own note; still true after this migration.

-- ===========================================================================
-- is_gate must survive a copy from template to a school's year, or the fix
-- above is inert — no school_tasks row would ever carry it. Both writers of
-- school_tasks from a derived task list take it from the same jsonb shape
-- pipeline-year.ts already builds (est_hours flows the identical way);
-- coalesce to false so this is safe before the TypeScript side sends it too.
-- ===========================================================================
create or replace function public.create_school_year(
  p_client_id        uuid,
  p_template_id      uuid,
  p_started_on       date,
  p_open_days        date[],
  p_answers          jsonb,
  p_account_owner_id uuid,
  p_months           jsonb,
  p_tasks            jsonb
) returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_year_id uuid;
begin
  insert into school_years
    (client_id, template_id, account_owner_id, started_on, open_days, planning_answers, planned_by)
  values
    (p_client_id, p_template_id, p_account_owner_id, p_started_on, p_open_days, p_answers, current_team_member_id())
  returning id into v_year_id;

  insert into school_year_months (year_id, month_no, theme, role, starts_on)
  select v_year_id, (m->>'month_no')::int, m->>'theme', m->>'role', (m->>'starts_on')::date
    from jsonb_array_elements(p_months) m;

  insert into school_tasks
    (year_id, month_no, home_month_no, label, side, department_id, est_hours, source, service_id, ordinal, is_gate)
  select v_year_id, (t->>'month_no')::int, (t->>'month_no')::int, t->>'label', t->>'side',
         nullif(t->>'department_id','')::uuid, (t->>'est_hours')::numeric,
         coalesce(t->>'source','template'), nullif(t->>'service_id','')::uuid,
         coalesce((t->>'ordinal')::int, 0), coalesce((t->>'is_gate')::boolean, false)
    from jsonb_array_elements(p_tasks) t;

  -- The school is in month 1 the moment the year exists, so month 1 has
  -- arrived: its tasks get dates and its school-side work becomes asks.
  perform schedule_school_year_month(v_year_id, 1);

  return v_year_id;
end;
$$;

create or replace function public.replan_school_year(
  p_year_id   uuid,
  p_open_days date[],
  p_answers   jsonb,
  p_months    jsonb,
  p_tasks     jsonb
) returns void
language plpgsql
set search_path to 'public'
as $$
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
     and state = 'planned' and source = 'template' and moved_at is null;

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
$$;
