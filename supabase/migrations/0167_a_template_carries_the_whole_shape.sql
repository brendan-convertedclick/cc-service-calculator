-- 0167_a_template_carries_the_whole_shape.sql
-- Apply via mcp__cc-supabase__apply_migration (name: a_template_carries_the_whole_shape)
--
-- Lisa, 2026-09-10: "Can you create this Retainer for me — called 'New Schools
-- Monthly Tasks Retainer' and save it as a template?" — where the retainer is a
-- set of routines that only mean anything because of WHEN they land: every
-- Monday, Mondays/Wednesdays/Fridays, the 15th, the 20th, month end.
--
-- 0166 stored a template as service + cadence + occurrences + points, on the
-- reasoning that a template is a shape and everything else belongs to the
-- agreement. That was right about fees and assignees and wrong about timing.
-- `retainer_recurring_services` carries eight more columns that decide what the
-- provisioner actually makes, and a template that drops them produces five
-- undated tasks with the right names — which looks like it worked.
--
-- The line stays where it was, just drawn correctly: a template carries
-- everything about the WORK (what, how often, when, what it is called, what is
-- on its checklist) and nothing about the DEAL or the PEOPLE (fee, hours target,
-- client, ClickUp list, assignees). Those are still asked for every time.
--
-- Types and defaults mirror retainer_recurring_services exactly, so applying a
-- template is a column-for-column copy and cannot drift.

alter table public.retainer_template_services
  add column if not exists occurrence_labels text[] not null default '{}',
  add column if not exists occurrence_start_days integer[] not null default '{}',
  add column if not exists occurrence_due_days integer[] not null default '{}',
  add column if not exists label_as_task_name boolean not null default false,
  add column if not exists roll_up_monthly boolean not null default false,
  add column if not exists task_description text,
  add column if not exists checklist_items text[] not null default '{}',
  -- 0 = Sunday, 1 = Monday … matching Date.getUTCDay(), which is what
  -- provision-retainer-period's weekdayDatesInPeriod() compares against.
  -- Null means "not weekday-anchored" and the cadence decides.
  add column if not exists recur_weekday smallint;

alter table public.retainer_template_services
  drop constraint if exists retainer_template_services_weekday_chk;
alter table public.retainer_template_services
  add constraint retainer_template_services_weekday_chk
    check (recur_weekday is null or recur_weekday between 0 and 6);

comment on column public.retainer_template_services.recur_weekday is
  'Weekday this service repeats on, 0=Sunday..6=Saturday, or null for cadence-driven spacing. A routine that happens every Monday is not "4 times a month" — it is however many Mondays the month has, which is what the provisioner works out.';

comment on column public.retainer_template_services.occurrence_due_days is
  'Day of month each occurrence is due, one per occurrence. Empty means the provisioner decides: month end for a monthly service, the occurrence date otherwise. Deliberately leave it empty for "due at month end" — a literal 30 is wrong in February and the provisioner already clamps to the real last day.';
