-- 0120_staff_briefs_system_id.sql
-- Apply via mcp__cc-supabase__apply_migration (name: staff_briefs_system_id)
--
-- Optional workflow (Systems library entry) a staff brief is run from. Its
-- top-level process_steps are stamped onto the ClickUp task as a checklist at
-- approval time (approve-staff-brief), so edits in /systems keep propagating
-- until the brief is actually approved.

alter table staff_briefs
  add column if not exists system_id uuid references system_definitions(id) on delete set null;
