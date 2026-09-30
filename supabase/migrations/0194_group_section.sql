-- 0194_group_section.sql
--
-- Groups sit under one of three sections on the planner and in Year
-- results: Acquisition (winning enquiries and enrolments), Presence (being
-- seen and trusted in the area) and Account (running the relationship).
-- Acquisition and presence are the two things the school is buying; the
-- account section is how we deliver them.
--
-- Null means "use the default for the group's name" (sectionFor in
-- groupSections.ts), so nothing has to be set for the standard groups.

alter table public.results_groups add column if not exists section text
  check (section in ('acquisition', 'presence', 'account'));
alter table public.pipeline_group_styles add column if not exists section text
  check (section in ('acquisition', 'presence', 'account'));
