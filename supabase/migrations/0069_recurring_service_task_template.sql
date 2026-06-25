-- 0069_recurring_service_task_template.sql
-- Apply via mcp__cc-supabase__apply_migration (name: recurring_service_task_template)
--
-- Optional ClickUp Task Template id for a recurring service. When set, the
-- provisioner creates each occurrence FROM the template (inheriting its
-- description, checklist, subtasks and custom-field defaults), then layers on
-- the per-occurrence name, points, dates, parent and Conductor custom fields.
-- NULL = the normal blank-task create path.

alter table public.retainer_recurring_services
  add column if not exists clickup_task_template_id text;
