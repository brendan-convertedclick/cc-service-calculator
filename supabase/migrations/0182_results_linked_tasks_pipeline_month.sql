-- 0182_results_linked_tasks_pipeline_month.sql
--
-- Review finding (feat/results-month, pipeline tasks as plans): the calendar
-- placement of a linked task must match the pipeline column it actually sits
-- in — that column (school_tasks.month_no) is the single source of truth for
-- "which month is this task in", and 0180's first cut instead derived
-- year/month from whatever date effective_date landed on. Those usually
-- agree, but a gate task's due_date (school_task_due_on's is_gate branch,
-- 0159) is only clamped to its month's START, not its end — an open day
-- early in month_no+1 can push the six-week gate date up to ~12 days into
-- month_no+1's calendar month while the task itself stays filed under
-- month_no. A linked gate task would then show in Year results one column
-- over from where its own pipeline card sits, which is exactly the
-- "two sources for one truth" failure this schema keeps re-litigating.
--
-- year/month now come from school_year_months.starts_on for the task's own
-- (year_id, month_no) — the same row PlannerColumn renders the task under.
-- The DAY is still real: due_date if it falls inside that calendar month,
-- else school_task_due_on(...)'s date if THAT falls inside the month, else
-- null (the task places in "Anytime this month" rather than lying about a
-- day). effective_date is kept as "the date behind the day, or null" so a
-- caller doesn't have to reconstruct it from year/month/day.

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
  d.effective_date,
  extract(year  from m.starts_on)::int as year,
  extract(month from m.starts_on)::int as month,
  extract(day   from d.effective_date)::int as day
from public.results_task_links l
join public.school_tasks t on t.id = l.school_task_id
join public.school_years y on y.id = t.year_id
join public.school_year_months m on m.year_id = t.year_id and m.month_no = t.month_no
cross join lateral (
  select case
           -- due_date wins, but only when it actually lands in the task's
           -- own pipeline month — a gate date that overshot into next
           -- month's calendar range does not get to claim this month's day.
           when t.due_date is not null
            and date_trunc('month', t.due_date) = date_trunc('month', m.starts_on)
             then t.due_date
           -- Otherwise fall back to the date the month WILL hand it
           -- (clamp false, same as 0159's client calendar) — but only if
           -- that, too, falls inside this calendar month.
           when date_trunc('month', public.school_task_due_on(t.year_id, t.month_no, t.is_gate, false))
                = date_trunc('month', m.starts_on)
             then public.school_task_due_on(t.year_id, t.month_no, t.is_gate, false)
           -- Neither date belongs to this month: no day, not a lie — the
           -- task places as "Anytime this month" instead.
           else null
         end as effective_date
) d;

comment on view public.results_linked_tasks is
  'A linked pipeline task as Year results sees it. year/month are the task''s own pipeline column (school_year_months.starts_on for its year_id/month_no) — never derived from a date, so placement always matches the card in /pipeline. effective_date/day are the real date behind the chip (due_date if it falls in that column''s calendar month, else school_task_due_on with clamp false if that falls in it, else null for "anytime this month").';

grant select on public.results_linked_tasks to authenticated, service_role;
