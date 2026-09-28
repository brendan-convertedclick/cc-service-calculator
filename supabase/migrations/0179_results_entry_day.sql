-- 0179_results_entry_day.sql
--
-- Month view (addendum to 0178_school_results.sql): an entry can carry an
-- explicit day of its month, so it can be plotted (and planned) on a
-- specific date rather than only "sometime this month".
-- Spec: docs/superpowers/specs/2026-09-28-school-year-results-month-view.md
-- Idempotent: `add column if not exists`.

alter table public.results_entries
  add column if not exists day smallint check (day between 1 and 31);
