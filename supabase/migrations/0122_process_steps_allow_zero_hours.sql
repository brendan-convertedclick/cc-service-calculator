-- 0122_process_steps_allow_zero_hours.sql
-- Apply via mcp__cc-supabase__apply_migration (name: process_steps_allow_zero_hours)
--
-- Some documented steps genuinely take no measurable time (a check, a
-- confirmation, a hand-off). The old floor of 0.25h forced people to inflate
-- those to 15 minutes or leave them blank, so drop it to 0 and keep only the
-- "not negative" half of the rule. NULL still means "not estimated".

alter table process_steps drop constraint if exists process_steps_min_hours;

alter table process_steps
  add constraint process_steps_min_hours
  check (estimated_hours is null or estimated_hours >= 0);
