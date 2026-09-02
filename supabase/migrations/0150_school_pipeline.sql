-- 0150_school_pipeline.sql
-- Apply via mcp__cc-supabase__apply_migration (name: school_pipeline)
--
-- The school delivery year. APPLIED 2026-09-01 (see 0151 for its corrections).
--
-- Every school runs its own Month 1 to Month 12. There is no shared calendar:
-- two schools can both be in "Month 9" having started ten months apart, and
-- their open days sit in different months. A school's year is created by a
-- PLANNING SESSION whose answers are stored and from which all twelve months
-- are derived.
--
-- FIVE TABLES, THREE FUNCTIONS, ONE WIDENED CONSTRAINT ON client_approvals.
--
--   pipeline_templates          the editable central plan (one row per plan)
--   pipeline_template_themes    its themes, each with a ROLE the derivation reads
--   pipeline_template_tasks     the task list per theme
--   school_years                one school's year: start date, the answers
--   school_year_months          that school's twelve months, themed and closable
--   school_tasks                the work, per month, per side
--
-- THE TEMPLATE IS KEYED ON THEME, NOT ON MONTH NUMBER. This is the one
-- structural departure from the obvious shape and it is the whole design.
-- M2..M7 have no fixed themes — they are shaped by where the school's open
-- days actually land, and a school with three open days gets "Open day runs"
-- three times. A template keyed on month_no cannot say that. Keyed on theme,
-- the same seven tasks are copied into every month that earns that theme.
--
-- THE ROLE COLUMN IS WHY THE DERIVATION IS NOT LITERALS. A theme row carries
-- role='open_day' or 'filler' or 'spine'; the derivation reads roles. Renaming
-- "Build the audience" in the template does not break the prize-month rule.
--
-- WHAT A SCHOOL KEEPS. Seeding COPIES rows. Editing the template afterwards
-- changes what future schools are seeded with and nothing about a school
-- already mapped — which is addition 3's entire promise, and it is kept by
-- copying rather than by pointing.
--
-- Additive only: no DROP of data. The one ALTER on client_approvals widens a
-- check; every existing row passes it (verified: 6 brief rows, all with a
-- brief_id and a null item_id).

-- ===========================================================================
-- 1. The central template
-- ===========================================================================

create table if not exists public.pipeline_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- There is no is_default boolean. settings is a single row and already holds
-- every other "which one does the app use" pointer, so the default lives
-- there: one default is true by construction, with no partial unique index to
-- reject the intermediate state of a two-statement swap (the exact problem
-- contacts.is_primary has, documented in CLAUDE.md).
alter table public.settings
  add column if not exists default_pipeline_template_id uuid references public.pipeline_templates(id);

create table if not exists public.pipeline_template_themes (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.pipeline_templates(id) on delete cascade,
  theme        text not null,
  role         text not null,
  pinned_month int,             -- spine only: the month number this theme always occupies
  ordinal      int not null default 0,
  created_at   timestamptz not null default now(),
  constraint pipeline_template_themes_role_chk
    check (role in ('spine', 'open_day_before', 'open_day', 'open_day_after', 'prize', 'filler')),
  -- A spine theme is defined by the month it is pinned to; every other role is
  -- defined by its relationship to an open day and cannot be pinned.
  constraint pipeline_template_themes_pinned_chk
    check ((role = 'spine') = (pinned_month is not null)),
  constraint pipeline_template_themes_month_chk
    check (pinned_month is null or pinned_month between 1 and 12),
  unique (template_id, theme)
);

-- Two months of one template cannot pin the same number...
create unique index if not exists pipeline_template_themes_pinned_idx
  on public.pipeline_template_themes (template_id, pinned_month)
  where pinned_month is not null;

-- ...and the derivation needs exactly one theme per non-spine role, or "which
-- theme is the open day month" has no answer.
create unique index if not exists pipeline_template_themes_role_idx
  on public.pipeline_template_themes (template_id, role)
  where role <> 'spine';

create table if not exists public.pipeline_template_tasks (
  id            uuid primary key default gen_random_uuid(),
  theme_id      uuid not null references public.pipeline_template_themes(id) on delete cascade,
  label         text not null,
  side          text not null,
  department_id uuid references public.departments(id),
  est_hours     numeric(6,2),   -- nullable: the team estimates tasks it knows, see CLAUDE.md
  ordinal       int not null default 0,
  created_at    timestamptz not null default now(),
  constraint pipeline_template_tasks_side_chk check (side in ('us', 'school'))
);
-- template_id is deliberately NOT denormalised onto this table. It is reachable
-- through theme_id, and a second copy is a second truth.

create index if not exists pipeline_template_tasks_theme_idx
  on public.pipeline_template_tasks (theme_id, ordinal);

-- ===========================================================================
-- 2. One school's year
-- ===========================================================================

create table if not exists public.school_years (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  template_id      uuid not null references public.pipeline_templates(id) on delete restrict,
  account_owner_id uuid references public.team_members(id),  -- nullable: the shared team@ login resolves to null
  started_on       date not null,
  open_days        date[] not null default '{}',
  planning_answers jsonb not null default '{}'::jsonb,
  planned_at       timestamptz not null default now(),
  planned_by       uuid references public.team_members(id),
  completed_at     timestamptz,          -- stamped when M12 closes
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- THERE IS NO current_month COLUMN. The current month is
-- min(month_no) where closed_at is null — one fact, one place. Storing it too
-- would give two sources for one truth and a guaranteed drift, which is the
-- dominant defect this codebase has already audited itself for.

-- THERE IS NO state COLUMN either: completed_at is the state, the same shape
-- as decided_at on client_approvals. A live year is one with no completion
-- stamp, and that is what makes "one live year per school" indexable:
create unique index if not exists school_years_live_idx
  on public.school_years (client_id)
  where completed_at is null;

create table if not exists public.school_year_months (
  id         uuid primary key default gen_random_uuid(),
  year_id    uuid not null references public.school_years(id) on delete cascade,
  month_no   int not null,
  theme      text not null,   -- SNAPSHOT of the template's theme name at seed
  role       text not null,   -- SNAPSHOT of the template's role at seed
  starts_on  date not null,
  closed_at  timestamptz,
  closed_by  uuid references public.team_members(id),
  constraint school_year_months_no_chk check (month_no between 1 and 12),
  constraint school_year_months_closed_chk check ((closed_at is null) = (closed_by is null)),
  unique (year_id, month_no)
);

-- theme AND role are snapshots, like decided_title/decided_ask (0142): the
-- template is editable and renameable, so a six-week check that matched the
-- month's theme TEXT against the template's current open_day_before name would
-- silently stop firing the day somebody renamed it. role is what the rule
-- reads; theme is what the person reads.

-- The kanban asks every live year for its lowest open month, so index exactly
-- that. Small, because most months of a year are closed.
create index if not exists school_year_months_open_idx
  on public.school_year_months (year_id, month_no)
  where closed_at is null;

create table if not exists public.school_tasks (
  id                 uuid primary key default gen_random_uuid(),
  year_id            uuid not null references public.school_years(id) on delete cascade,
  month_no           int not null,
  home_month_no      int not null,   -- filled from month_no on insert by the trigger below
  label              text not null,
  side               text not null,
  department_id      uuid references public.departments(id),
  assignee_id        uuid references public.team_members(id),
  est_hours          numeric(6,2),
  source             text not null default 'template',
  service_id         uuid references public.services(id) on delete set null,
  state              text not null default 'planned',
  due_date           date,
  done_at            timestamptz,
  done_by            uuid references public.team_members(id),
  client_approval_id uuid references public.client_approvals(id) on delete set null,
  brief_id           uuid references public.briefs(id) on delete set null,
  moved_by           uuid references public.team_members(id),
  moved_at           timestamptz,
  ordinal            int not null default 0,
  created_at         timestamptz not null default now(),

  -- "a task sits in a month that exists" is a database guarantee, not something
  -- every caller must remember — the composite-FK trick 0142 used for
  -- (contact_id, client_id).
  constraint school_tasks_month_fkey
    foreign key (year_id, month_no) references public.school_year_months (year_id, month_no)
    on delete cascade,

  constraint school_tasks_home_month_chk check (home_month_no between 1 and 12),
  constraint school_tasks_side_chk        check (side in ('us', 'school')),
  constraint school_tasks_source_chk      check (source in ('template', 'service', 'manual')),
  constraint school_tasks_state_chk       check (state in ('planned', 'scheduled', 'done')),

  -- A service task knows its service and nothing else does.
  constraint school_tasks_service_chk     check ((source = 'service') = (service_id is not null)),

  -- THE SENTENCE THE BRIEF WROTE, MADE LITERAL: "A task in a future month is
  -- PLANNED (no date). It becomes SCHEDULED, with a date, the moment the school
  -- arrives in that month." A planned task with a date is a promise nobody
  -- made; a scheduled one without a date is a deadline nobody can miss.
  constraint school_tasks_planned_chk     check ((state = 'planned') = (due_date is null)),

  -- Done and its stamp move together, the client_approvals_decided_chk rule.
  constraint school_tasks_done_chk        check ((state = 'done') = (done_at is not null)),

  -- EACH SIDE OF THE YEAR HAS EXACTLY ONE DOWNSTREAM SYSTEM. School-side work
  -- becomes a client ask on the existing sign-off page; our work becomes a
  -- brief, which is how it reaches ClickUp through the path that already
  -- exists. Neither can point the wrong way.
  constraint school_tasks_approval_side_chk check (client_approval_id is null or side = 'school'),
  constraint school_tasks_brief_side_chk    check (brief_id is null or side = 'us')
);

-- One task, one ask. The reverse link (client_approvals.item_id) is covered by
-- the widened brief_ref check below.
create unique index if not exists school_tasks_approval_idx
  on public.school_tasks (client_approval_id)
  where client_approval_id is not null;

-- The workhorse: the drawer's month list, the planner's twelve columns and
-- every per-month hours total are all this one lookup.
create index if not exists school_tasks_month_idx
  on public.school_tasks (year_id, month_no, ordinal);

comment on table public.school_tasks is
  'One row per task in one school''s year. month_no is where it sits now, home_month_no where the template put it — they differ exactly when somebody moved it, which is what the "from M5" badge reads.';

-- ===========================================================================
-- 3. Closed months are locked, and the lock is not decoration
-- ===========================================================================
-- Two halves. The month row itself is locked by RLS (section 4): an UPDATE
-- policy of `using (closed_at is null) with check (closed_at is null)` means a
-- direct browser write can neither edit a closed month nor close an open one.
-- Closing is therefore only ever the RPC.
--
-- This trigger is the other half: it stops work being dragged INTO or OUT OF a
-- closed month, including by deleting it, which is the same corruption wearing
-- a different verb. Triggers fire for service-role writes too (RLS is bypassed,
-- triggers are not) — that is deliberate here: nothing should rewrite a closed
-- month, including the RPCs, which only ever touch open ones.
create or replace function public.tg_school_tasks_guard()
returns trigger
language plpgsql
as $$
declare
  v_closed timestamptz;
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
    select closed_at into v_closed from public.school_year_months
     where year_id = old.year_id and month_no = old.month_no;
    if v_closed is not null then
      raise exception 'school_tasks: month % is closed — work cannot be moved out of it', old.month_no;
    end if;
    -- Who moved it and when. Stamped here rather than by the drag mutation so
    -- there is one place it can be forgotten, and it is none.
    new.moved_at := now();
    new.moved_by := public.current_team_member_id();
  end if;

  select closed_at into v_closed from public.school_year_months
   where year_id = new.year_id and month_no = new.month_no;
  if v_closed is not null then
    raise exception 'school_tasks: month % is closed — work cannot be scheduled into it', new.month_no;
  end if;

  if tg_op = 'INSERT' and new.home_month_no is null then
    new.home_month_no := new.month_no;
  end if;

  return new;
end;
$$;

drop trigger if exists school_tasks_guard on public.school_tasks;
create trigger school_tasks_guard
  before insert or update or delete on public.school_tasks
  for each row execute function public.tg_school_tasks_guard();

drop trigger if exists pipeline_templates_touch on public.pipeline_templates;
create trigger pipeline_templates_touch before update on public.pipeline_templates
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists school_years_touch on public.school_years;
create trigger school_years_touch before update on public.school_years
  for each row execute function public.tg_touch_updated_at();

-- ===========================================================================
-- 4. RLS
-- ===========================================================================
-- House posture (0118/0126/0139/0148): staff read and write freely, and the
-- gates go on the acts that are genuinely privileged. Two acts are.
--
-- No anon policy anywhere. A school never touches Postgres — school-side work
-- reaches them as client_approvals rows through the existing client-review
-- edge function, which runs on the service role.

alter table public.pipeline_templates       enable row level security;
alter table public.pipeline_template_themes enable row level security;
alter table public.pipeline_template_tasks  enable row level security;
alter table public.school_years             enable row level security;
alter table public.school_year_months       enable row level security;
alter table public.school_tasks             enable row level security;

-- THE TEMPLATE IS ADMIN/OWNER TO WRITE. It is the analogue of publishing a
-- procedure: editing it changes what every future school is handed. Unlike
-- system_revisions there is no draft that staff must still be able to write,
-- so this is a plain RLS gate and needs no SECURITY DEFINER function.
drop policy if exists pipeline_templates_read on public.pipeline_templates;
create policy pipeline_templates_read on public.pipeline_templates
  for select to authenticated using (true);
drop policy if exists pipeline_templates_write on public.pipeline_templates;
create policy pipeline_templates_write on public.pipeline_templates
  for all to authenticated
  using (coalesce(public.current_team_member_role(), '') in ('admin', 'owner'))
  with check (coalesce(public.current_team_member_role(), '') in ('admin', 'owner'));

drop policy if exists pipeline_template_themes_read on public.pipeline_template_themes;
create policy pipeline_template_themes_read on public.pipeline_template_themes
  for select to authenticated using (true);
drop policy if exists pipeline_template_themes_write on public.pipeline_template_themes;
create policy pipeline_template_themes_write on public.pipeline_template_themes
  for all to authenticated
  using (coalesce(public.current_team_member_role(), '') in ('admin', 'owner'))
  with check (coalesce(public.current_team_member_role(), '') in ('admin', 'owner'));

drop policy if exists pipeline_template_tasks_read on public.pipeline_template_tasks;
create policy pipeline_template_tasks_read on public.pipeline_template_tasks
  for select to authenticated using (true);
drop policy if exists pipeline_template_tasks_write on public.pipeline_template_tasks;
create policy pipeline_template_tasks_write on public.pipeline_template_tasks
  for all to authenticated
  using (coalesce(public.current_team_member_role(), '') in ('admin', 'owner'))
  with check (coalesce(public.current_team_member_role(), '') in ('admin', 'owner'));

-- A school's own year is everybody's to run. Planning a school, dragging its
-- work and ticking it off are the job, not an approval.
drop policy if exists school_years_authed_all on public.school_years;
create policy school_years_authed_all on public.school_years
  for all to authenticated using (true) with check (true);

drop policy if exists school_tasks_authed_all on public.school_tasks;
create policy school_tasks_authed_all on public.school_tasks
  for all to authenticated using (true) with check (true);

-- ...except the month row, whose closed_at IS the lock. Split policies:
-- anybody may create a month and edit an OPEN one, nobody may edit a closed
-- one, and the `with check` clause means no direct write can set closed_at at
-- all. Closing and reopening are the two functions below and nothing else.
drop policy if exists school_year_months_read on public.school_year_months;
create policy school_year_months_read on public.school_year_months
  for select to authenticated using (true);
drop policy if exists school_year_months_insert on public.school_year_months;
create policy school_year_months_insert on public.school_year_months
  for insert to authenticated with check (closed_at is null);
drop policy if exists school_year_months_update on public.school_year_months;
create policy school_year_months_update on public.school_year_months
  for update to authenticated
  using (closed_at is null) with check (closed_at is null);
drop policy if exists school_year_months_delete on public.school_year_months;
create policy school_year_months_delete on public.school_year_months
  for delete to authenticated using (closed_at is null);

-- ===========================================================================
-- 5. client_approvals: a brief-type row may be backed by a school task
-- ===========================================================================
-- Addition 5 puts school-side work on the EXISTING sign-off page rather than
-- building a second list. item_type stays 'brief' — the client controls for a
-- brief (Approve / Request changes) are exactly right for "Open day dates for
-- the whole year", and CLAUDE.md forbids renaming that value.
--
-- But client_approvals_brief_ref_chk demands a brief_id, and a school task has
-- no brief. item_id is the escape hatch 0139 built for precisely this ("keep
-- the door open ... without a second table"), so the check now says what it was
-- always protecting: a brief-type row must point at SOMETHING. num_nonnulls = 1
-- makes it strictly tighter than before, not looser — a row claiming both a
-- brief and a task was legal yesterday and is not now.
alter table public.client_approvals drop constraint if exists client_approvals_brief_ref_chk;
alter table public.client_approvals
  add constraint client_approvals_brief_ref_chk
  check (item_type <> 'brief' or num_nonnulls(brief_id, item_id) = 1);

comment on column public.client_approvals.item_id is
  'What a non-brief-backed item points at. For a school-side pipeline task this is school_tasks.id; school_tasks.client_approval_id is the same link read the other way.';

-- ===========================================================================
-- 6. Scheduling a month, closing one, reopening one
-- ===========================================================================
-- ALL DUE-DATE MATHS LIVES HERE AND NOWHERE ELSE. Creating a year schedules
-- M1; closing month N schedules N+1. Two callers, one rule — the alternative
-- was the same two rules written once in TypeScript and once in plpgsql, which
-- is the drift this codebase has already audited itself for. The YEAR
-- DERIVATION (which theme lands in which month, which tasks are copied) stays
-- in TypeScript where vitest can reach it; it produces no dates.
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

  -- THE SIX-WEEK RULE, MADE A DATE. A build month exists because an open day
  -- falls in the month after it; the school's approval is the hard deadline
  -- and it is six weeks before that day, not the end of the month it sits in.
  -- Read off role, never off the theme text, because the theme is renameable.
  -- Deliberately NOT clamped forward: if that date has passed the run-up is
  -- already compromised and the page must say so, which a clamped date hides.
  if v_month.role = 'open_day_before' then
    select min(d) into v_open_day
      from school_years y, unnest(y.open_days) as d
     where y.id = p_year_id
       and d >= (v_month.starts_on + interval '1 month')::date
       and d <  (v_month.starts_on + interval '2 months')::date;
    if v_open_day is not null then
      v_gate := v_open_day - 42;
    end if;
  end if;

  for t in
    select * from school_tasks
     where year_id = p_year_id and month_no = p_month_no and state = 'planned'
     order by ordinal, id
  loop
    update school_tasks
       set state    = 'scheduled',
           due_date = case when t.side = 'school' and v_gate is not null then v_gate else v_last_day end
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
         case when v_gate is not null then v_gate else v_last_day end,
         'client', 'us', 'pending', current_team_member_id())
      returning id into v_approval;

      update school_tasks set client_approval_id = v_approval where id = t.id;
    end if;
  end loop;
end;
$$;

-- Closing a month is the one transition that must not be half-done: it stamps
-- the month, schedules the next one with real dates and creates that month's
-- client asks. A browser doing those as three writes can die between them and
-- leave a school in a month that has arrived without any work in it. SECURITY
-- DEFINER because the RLS policy above deliberately makes closed_at unwritable
-- by anyone — this function and its mirror are the only two doors.
--
-- NO ROLE CHECK, deliberately, for the reason system_revision_back_to_draft
-- gives: finishing the month's work is the job of whoever is doing it. There
-- is no approval here to gate.
create or replace function public.close_school_year_month(p_year_id uuid, p_month_no int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_month     school_year_months%rowtype;
  v_current   int;
  v_open      int;
  v_client_id uuid;
  v_started   date;
begin
  if current_team_member_role() is null then
    raise exception 'close_school_year_month: sign in as a team member';
  end if;

  select client_id, started_on into v_client_id, v_started from school_years where id = p_year_id;
  if v_client_id is null then
    raise exception 'close_school_year_month: year % not found', p_year_id;
  end if;

  select * into v_month from school_year_months
   where year_id = p_year_id and month_no = p_month_no;
  if v_month.id is null then
    raise exception 'close_school_year_month: month % of year % not found', p_month_no, p_year_id;
  end if;
  if v_month.closed_at is not null then
    raise exception 'close_school_year_month: month % is already closed', p_month_no;
  end if;

  -- A year runs forwards. Closing M7 while M5 is open would leave a school in
  -- two places at once, and "current month" is defined as the lowest open one.
  select min(month_no) into v_current from school_year_months
   where year_id = p_year_id and closed_at is null;
  if v_current <> p_month_no then
    raise exception 'close_school_year_month: month % is open — close that first', v_current;
  end if;

  -- The month closes because the work is done, not instead of it. A school
  -- that will not finish something moves it to a later month; that door is
  -- open until the moment this one shuts.
  select count(*) into v_open from school_tasks
   where year_id = p_year_id and month_no = p_month_no and state <> 'done';
  if v_open > 0 then
    raise exception 'close_school_year_month: % task(s) in month % are not done — finish them or move them forward', v_open, p_month_no;
  end if;

  update school_year_months
     set closed_at = now(), closed_by = current_team_member_id()
   where id = v_month.id;

  if p_month_no < 12 then
    perform schedule_school_year_month(p_year_id, p_month_no + 1);
  else
    update school_years set completed_at = now() where id = p_year_id;

    -- M12 closing ends the year and books the next planning session. It is
    -- booked where every other commitment of ours already lives rather than in
    -- a column nothing reads: an agreement owed by us, on the client's page.
    -- agreed_at/agreed_via are non-negotiable on this table (agreement_chk).
    insert into client_approvals
      (client_id, item_type, client_title, ask, due_date,
       owed_by, raised_by, state, agreed_at, agreed_via, created_by)
    values
      (v_client_id, 'agreement', 'Next year''s planning session',
       'Book the planning session that sets up the next twelve months.',
       (v_started + interval '12 months')::date,
       'us', 'us', 'pending', current_date, 'other', current_team_member_id());
  end if;
end;
$$;

revoke execute on function public.close_school_year_month(uuid, int) from public;
grant execute on function public.close_school_year_month(uuid, int) to authenticated;

-- The mirror. Only the most recently closed month reopens: reopening M3 while
-- M4 and M5 are closed would put the school in two months at once, and the
-- month after it is already scheduled and already asked. This is a correction
-- affordance, not time travel — M+1's dates and client asks are LEFT AS THEY
-- ARE, because unwinding an ask a school has already seen is worse than a
-- month that arrived slightly early. Reopening M12 un-completes the year; the
-- next-planning agreement stays and is cancelled by hand if it was wrong.
create or replace function public.reopen_school_year_month(p_year_id uuid, p_month_no int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_last int;
begin
  if current_team_member_role() is null then
    raise exception 'reopen_school_year_month: sign in as a team member';
  end if;

  select max(month_no) into v_last from school_year_months
   where year_id = p_year_id and closed_at is not null;

  if v_last is null then
    raise exception 'reopen_school_year_month: nothing is closed on this year';
  end if;
  if v_last <> p_month_no then
    raise exception 'reopen_school_year_month: month % is the last one closed — reopen that instead', v_last;
  end if;

  update school_year_months
     set closed_at = null, closed_by = null
   where year_id = p_year_id and month_no = p_month_no;

  if p_month_no = 12 then
    update school_years set completed_at = null where id = p_year_id;
  end if;
end;
$$;

revoke execute on function public.reopen_school_year_month(uuid, int) from public;
grant execute on function public.reopen_school_year_month(uuid, int) to authenticated;

comment on function public.close_school_year_month(uuid, int) is
  'Close the current month of a school year and advance it: stamps closed_at, schedules month+1 with real dates and creates its client asks, and on month 12 completes the year and books the next planning session. Any team member. The only writer of school_year_months.closed_at.';

-- ===========================================================================
-- 7. Creating a year, atomically
-- ===========================================================================
-- Not SECURITY DEFINER — it needs no privilege the caller lacks. It exists for
-- ATOMICITY: a browser inserting a year, then twelve months, then seventy
-- tasks can die in the middle and leave a school half-planned. The derivation
-- that produced p_months/p_tasks is pure TypeScript (src/lib/pipeline-year.ts),
-- which is where vitest can see it; this function only writes what it is given.
create or replace function public.create_school_year(
  p_client_id        uuid,
  p_template_id      uuid,
  p_started_on       date,
  p_open_days        date[],
  p_answers          jsonb,
  p_account_owner_id uuid,
  p_months           jsonb,   -- [{month_no, theme, role, starts_on}, ...] x12
  p_tasks            jsonb    -- [{month_no, label, side, department_id, est_hours, source, service_id, ordinal}, ...]
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
    (year_id, month_no, home_month_no, label, side, department_id, est_hours, source, service_id, ordinal)
  select v_year_id, (t->>'month_no')::int, (t->>'month_no')::int, t->>'label', t->>'side',
         nullif(t->>'department_id','')::uuid, (t->>'est_hours')::numeric,
         coalesce(t->>'source','template'), nullif(t->>'service_id','')::uuid,
         coalesce((t->>'ordinal')::int, 0)
    from jsonb_array_elements(p_tasks) t;

  -- The school is in month 1 the moment the year exists, so month 1 has
  -- arrived: its tasks get dates and its school-side work becomes asks.
  perform schedule_school_year_month(v_year_id, 1);

  return v_year_id;
end;
$$;

revoke execute on function public.create_school_year(uuid, uuid, date, date[], jsonb, uuid, jsonb, jsonb) from public;
grant execute on function public.create_school_year(uuid, uuid, date, date[], jsonb, uuid, jsonb, jsonb) to authenticated;

-- ===========================================================================
-- 8. The default template, seeded verbatim from the source decks
-- ===========================================================================
-- This is addition 3's "real DB record, not hardcoded". Departments and hours
-- are deliberately left null: they are filled in the template editor by the
-- people who know them, and a guessed number that sums into a month header is
-- worse than a blank one.
do $seed$
declare
  v_tpl uuid;
  v_th  uuid;
  r     record;
begin
  if exists (select 1 from pipeline_templates where name = 'Schools — 12 month year') then
    return;
  end if;

  insert into pipeline_templates (name, notes)
  values ('Schools — 12 month year',
          'The default plan a school is seeded with. Six spine months barely move; the rest are shaped by where the school''s open days land.')
  returning id into v_tpl;

  update settings set default_pipeline_template_id = v_tpl where default_pipeline_template_id is null;

  for r in
    select * from (values
      ('Set the year up',              'spine',            1,  1),
      ('Build the open day machine',   'open_day_before',  null, 2),
      ('Open day runs',                'open_day',         null, 3),
      ('Convert the interest',         'open_day_after',   null, 4),
      ('Build the audience',           'prize',            null, 5),
      ('Applications and housekeeping','filler',           null, 6),
      ('Offers go out',                'spine',            8,  7),
      ('Acceptances land',             'spine',            9,  8),
      ('Fill the gaps',                'spine',            10, 9),
      ('Close the year out',           'spine',            11, 10),
      ('Build the bank',               'spine',            12, 11)
    ) as v(theme, role, pinned_month, ordinal)
  loop
    insert into pipeline_template_themes (template_id, theme, role, pinned_month, ordinal)
    values (v_tpl, r.theme, r.role, r.pinned_month, r.ordinal);
  end loop;

  for r in
    select * from (values
      ('Set the year up','Open day dates for the whole year','school',1),
      ('Set the year up','Signed KPI sheet','school',2),
      ('Set the year up','Ultimate guides refreshed','us',3),
      ('Set the year up','School calendar published','us',4),
      ('Set the year up','SEO health check, and fix what it finds','us',5),
      ('Set the year up','Always-on search live','us',6),
      ('Set the year up','Tracking verified with a live submission','us',7),
      ('Set the year up','A named content owner, not five people','school',8),

      ('Build the open day machine','One creative run covering every open day this year','us',1),
      ('Build the open day machine','Landing page built and tested','us',2),
      ('Build the open day machine','Booking forms feeding Granite','us',3),
      ('Build the open day machine','Emailer and WhatsApp steps built','us',4),
      ('Build the open day machine','Campaign built in Slate, ready but not live','us',5),
      ('Build the open day machine','Creative approved — the hard deadline','school',6),
      ('Build the open day machine','Event details: time, parking, what parents see','school',7),

      ('Open day runs','Campaign goes live','us',1),
      ('Open day runs','Bookings flowing into the pipeline daily','us',2),
      ('Open day runs','Follow-up sequence firing automatically','us',3),
      ('Open day runs','Reminder sequence in the final week','us',4),
      ('Open day runs','Attendance recorded against bookings','us',5),
      ('Open day runs','Attendance list on the day','school',6),
      ('Open day runs','Approvals inside five days','school',7),

      ('Convert the interest','Post-open-day nurture for every booked family','us',1),
      ('Convert the interest','Application prompts to everyone who attended','us',2),
      ('Convert the interest','Ultimate guide published and flighted','us',3),
      ('Convert the interest','Reviews requested from attending families','us',4),
      ('Convert the interest','Pipeline review: who is stuck, and why','us',5),
      ('Convert the interest','Application process and deadlines confirmed','school',6),

      ('Build the audience','Prize and follow campaign built and launched','us',1),
      ('Build the audience','Ultimate guide published and flighted','us',2),
      ('Build the audience','Reach and follower growth reported','us',3),
      ('Build the audience','Prize confirmed, with terms','school',4),
      ('Build the audience','Approval on the campaign mechanics','school',5),

      ('Applications and housekeeping','Application support content published','us',1),
      ('Applications and housekeeping','Mid-year SEO health check','us',2),
      ('Applications and housekeeping','Pipeline cleanup — stale enquiries reworked','us',3),
      ('Applications and housekeeping','Half-year review of targets against actuals','us',4),
      ('Applications and housekeeping','Application numbers to date','school',5),
      ('Applications and housekeeping','Any change to capacity or fees','school',6),

      ('Offers go out','Support content for families deciding','us',1),
      ('Offers go out','Acceptance nurture running','us',2),
      ('Offers go out','Prize campaign concludes and reports','us',3),
      ('Offers go out','Reviews requested from current parents','us',4),
      ('Offers go out','Offer timeline confirmed','school',5),
      ('Offers go out','Which families have received offers','school',6),

      ('Acceptances land','Deposit and acceptance follow-up','us',1),
      ('Acceptances land','Ultimate guide published','us',2),
      ('Acceptances land','Enrolments recorded and attributed','us',3),
      ('Acceptances land','The loop closed: enquiry to enrolment, traced','us',4),
      ('Acceptances land','Confirmed acceptances and deposits','school',5),
      ('Acceptances land','Enrolment numbers as they land','school',6),

      ('Fill the gaps','Late application push','us',1),
      ('Fill the gaps','Targeted campaigns for under-filled grades','us',2),
      ('Fill the gaps','Next year planning begins','us',3),
      ('Fill the gaps','Which grades are still under-filled','school',4),
      ('Fill the gaps','Next year targets','school',5),
      ('Fill the gaps','Any fee or capacity change','school',6),

      ('Close the year out','Final enrolment push','us',1),
      ('Close the year out','Full-year results and attribution report','us',2),
      ('Close the year out','Next year targets agreed and documented','us',3),
      ('Close the year out','Final enrolment numbers','school',4),
      ('Close the year out','Budget confirmed for next year','school',5),
      ('Close the year out','Renewal decision','school',6),

      ('Build the bank','Content produced and banked for next year','us',1),
      ('Build the bank','Calendar refreshed for the year ahead','us',2),
      ('Build the bank','Light social only','us',3)
    ) as v(theme, label, side, ordinal)
  loop
    select id into v_th from pipeline_template_themes
     where template_id = v_tpl and theme = r.theme;
    insert into pipeline_template_tasks (theme_id, label, side, ordinal)
    values (v_th, r.label, r.side, r.ordinal);
  end loop;
end;
$seed$;

-- ===========================================================================
-- 9. A school is a client, flagged
-- ===========================================================================
-- The board needs "which clients belong here" before any of them has a year —
-- the Not-started column is the whole entry point. A boolean on clients is the
-- smallest thing that answers it: no second table, no parent-client graph, and
-- the existing clients RLS already governs who may set it. town is here for the
-- same reason: the card's second line, and nowhere else in the app holds one.
alter table public.clients
  add column if not exists is_school boolean not null default false,
  add column if not exists town      text;

comment on column public.clients.is_school is
  'On the /pipeline board. Set from the board''s "Add a school" dialog; there is no other writer.';

-- ===========================================================================
-- 10. State follows the column
-- ===========================================================================
-- The guard stamped moved_by/moved_at on a move but left state/due_date alone,
-- so a planned task dragged into the current month landed dateless and
-- constraint-legal — the spec's central sentence, silently violated. Put it
-- where both the drag path and the click-to-move path pass: this trigger,
-- which both input paths route through regardless of how the UI calls it.
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
  -- earned. Enforced here rather than in the drag handler because there are two
  -- input paths (drag and click-to-move) and one of them will be forgotten.
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

  return new;
end;
$$;

-- ponytail: a school-side task dragged into an open_day_before month keeps the
-- month-end date rather than re-deriving the six-week gate, and no
-- client_approvals row is minted by a move — only by arrival. Add both if
-- planners start moving school-side work across the run-up.

-- ===========================================================================
-- 11. A school-side task closes when its ask settles
-- ===========================================================================
-- Nothing linked the two directions. Without it a client approves on their
-- portal and the pipeline still shows the task open, which is the
-- two-sources-for-one-truth failure this repo audits itself for.
create or replace function public.tg_school_task_follows_approval()
returns trigger
language plpgsql
as $$
declare
  v_task   public.school_tasks%rowtype;
  v_closed timestamptz;
begin
  if new.item_type <> 'brief' or new.item_id is null then return new; end if;
  if new.state is not distinct from old.state then return new; end if;

  select * into v_task from public.school_tasks where id = new.item_id;
  if v_task.id is null then return new; end if;   -- item_id points at something else

  select closed_at into v_closed from public.school_year_months
   where year_id = v_task.year_id and month_no = v_task.month_no;

  if new.state = 'approved' and v_task.state <> 'done' then
    if v_closed is not null then
      raise exception 'This is a pipeline task in month %, which is closed — reopen month % on the pipeline first', v_task.month_no, v_task.month_no;
    end if;
    -- done_by stays null: the client decided this, not a team member.
    update public.school_tasks
       set state = 'done', done_at = coalesce(new.decided_at, now()), done_by = null
     where id = v_task.id;

  elsif new.state = 'pending' and v_task.state = 'done' then
    if v_closed is not null then
      raise exception 'This is a pipeline task in month %, which is closed — reopen month % on the pipeline first', v_task.month_no, v_task.month_no;
    end if;
    update public.school_tasks
       set state = 'scheduled', done_at = null, done_by = null
     where id = v_task.id;
  end if;

  -- changes_requested is deliberately a no-op: it comes back to us, it is not done.
  return new;
end;
$$;

drop trigger if exists client_approvals_school_task on public.client_approvals;
create trigger client_approvals_school_task
  after update of state on public.client_approvals
  for each row execute function public.tg_school_task_follows_approval();

-- The last school-side settle does NOT auto-close the month. Closing stays the
-- explicit RPC — the UX spec's "the same confirm appears for whoever is
-- looking" depends on it.

-- ===========================================================================
-- 12. Re-running the planning session
-- ===========================================================================
-- Re-planning is not re-creating. A closed month is history and the current
-- month has already been asked of the school, so this touches neither: it
-- re-themes the FUTURE open months and replaces only the untouched template
-- work in them. A task somebody moved (moved_at is not null), a service task,
-- or anything already scheduled or done survives — the operator's decisions
-- outrank the template's.
create or replace function public.replan_school_year(
  p_year_id   uuid,
  p_open_days date[],
  p_answers   jsonb,
  p_months    jsonb,   -- same shape as create_school_year
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

  insert into school_tasks
    (year_id, month_no, home_month_no, label, side, department_id, est_hours, source, service_id, ordinal)
  select p_year_id, (t->>'month_no')::int, (t->>'month_no')::int, t->>'label', t->>'side',
         nullif(t->>'department_id','')::uuid, (t->>'est_hours')::numeric,
         'template', null, coalesce((t->>'ordinal')::int, 0)
    from jsonb_array_elements(p_tasks) t
   where (t->>'month_no')::int > v_current;
end;
$$;

revoke execute on function public.replan_school_year(uuid, date[], jsonb, jsonb, jsonb) from public;
grant execute on function public.replan_school_year(uuid, date[], jsonb, jsonb, jsonb) to authenticated;
