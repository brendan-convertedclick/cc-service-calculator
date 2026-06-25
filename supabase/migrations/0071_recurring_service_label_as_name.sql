-- 0071_recurring_service_label_as_name.sql
-- Apply via mcp__cc-supabase__apply_migration (name: recurring_service_label_as_name)
--
-- When true, a per-occurrence label IS the task name (the service name is dropped
-- from the title), e.g. "Trellidor UK - Set budget for new month - June 2026" —
-- for services whose labels are full task descriptions rather than sub-identifiers.

alter table public.retainer_recurring_services
  add column if not exists label_as_task_name boolean not null default false;
