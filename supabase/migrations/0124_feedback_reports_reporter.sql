-- 0124_feedback_reports_reporter.sql
--
-- Who actually raised this. `created_by` is the auth account, and on a local
-- session that is always the shared team@ login (AuthContext's DEV_AUTO_LOGIN),
-- so on its own it answers "which browser" rather than "which person". The
-- roster row is the person: filled from the signed-in team member, or picked
-- from the roster when the session is the shared login.

alter table public.feedback_reports
  add column if not exists reporter_member_id uuid references public.team_members(id) on delete set null;
