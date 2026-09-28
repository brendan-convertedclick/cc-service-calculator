-- 0180_results_task_links.sql
--
-- School year results: pipeline tasks as plans (addendum). Spec:
-- docs/superpowers/specs/2026-09-28-school-year-results-pipeline-link.md
--
-- A school's pipeline task can BE a results row's plan for its month. One
-- link table, one row per task (a task links to at most one results row —
-- the primary key is the task id). Nothing about the task is copied: Year
-- results reads label/side/state/done_at/date LIVE off school_tasks on every
-- load, through a view that owns the one date rule (mirrors 0159's
-- client_pipeline_schedule: "never re-derive school_task_due_on's rule at
-- the call site").
-- Idempotent: safe to re-run (create table/index if not exists, drop policy
-- if exists, create or replace function/view).

create table if not exists public.results_task_links (
  school_task_id uuid primary key references public.school_tasks(id) on delete cascade,
  row_id         uuid not null references public.results_rows(id) on delete cascade,
  created_by     uuid references public.team_members(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists results_task_links_row_id_idx on public.results_task_links(row_id);

-- The link's two ends must belong to the same client: a task's school year
-- has a client_id, a results row's group has a client_id, and they must
-- match — handing someone a task linked into another client's board is
-- exactly the failure composite-FK tricks elsewhere in this schema exist to
-- prevent, but the two tables aren't siblings under one client_id column, so
-- a trigger is what enforces it here (the same job 0142's composite FK does
-- for contact_id/client_id, just via a check instead of a key).
create or replace function public.tg_results_task_links_same_client()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_task_client uuid;
  v_row_client  uuid;
begin
  select y.client_id into v_task_client
    from school_tasks t
    join school_years y on y.id = t.year_id
   where t.id = new.school_task_id;

  select g.client_id into v_row_client
    from results_rows r
    join results_groups g on g.id = r.group_id
   where r.id = new.row_id;

  if v_task_client is null or v_row_client is null or v_task_client is distinct from v_row_client then
    raise exception 'results_task_links: task and results row must belong to the same client';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_results_task_links_same_client on public.results_task_links;
create trigger trg_results_task_links_same_client
  before insert or update on public.results_task_links
  for each row execute function public.tg_results_task_links_same_client();

-- ============================================================
-- RLS — same stance as results_groups/rows/entries (0118/0178): staff link
-- tasks to results rows the same way they document procedures and record
-- results, no admin gate.
-- ============================================================

alter table public.results_task_links enable row level security;

drop policy if exists results_task_links_select on public.results_task_links;
create policy results_task_links_select on public.results_task_links
  for select to authenticated using (true);
drop policy if exists results_task_links_authed_write on public.results_task_links;
create policy results_task_links_authed_write on public.results_task_links
  for all to authenticated using (true) with check (true);

-- ============================================================
-- View: results_linked_tasks — the one place effective_date is computed.
-- ============================================================
-- effective_date is due_date if the task has one, else the date its month
-- will hand it (school_task_due_on with clamp forward FALSE — same choice
-- 0159's client_pipeline_schedule made for the same reason: a calendar
-- plotting a month that hasn't arrived must not clamp, or an unstarted
-- month piles onto today's square and today's square moves every morning).
-- year/month/day are extracted from that one date so callers never re-derive
-- it in JS with a toISOString() round trip (CLAUDE.md's SAST-date warning).
create or replace view public.results_linked_tasks
with (security_invoker = true) as
select
  l.school_task_id as task_id,
  l.row_id,
  t.year_id,
  y.client_id,
  t.label,
  t.side,
  t.state,
  t.done_at,
  coalesce(t.due_date, public.school_task_due_on(t.year_id, t.month_no, t.is_gate, false)) as effective_date,
  extract(year  from coalesce(t.due_date, public.school_task_due_on(t.year_id, t.month_no, t.is_gate, false)))::int as year,
  extract(month from coalesce(t.due_date, public.school_task_due_on(t.year_id, t.month_no, t.is_gate, false)))::int as month,
  extract(day   from coalesce(t.due_date, public.school_task_due_on(t.year_id, t.month_no, t.is_gate, false)))::int as day
from public.results_task_links l
join public.school_tasks t on t.id = l.school_task_id
join public.school_years y on y.id = t.year_id;

comment on view public.results_linked_tasks is
  'A linked pipeline task as Year results sees it: live off school_tasks, with the one date rule (due_date if set, else school_task_due_on with clamp false, same as 0159''s client calendar) computed once here instead of re-derived at every call site.';

grant select on public.results_linked_tasks to authenticated, service_role;
