-- 0070_recurring_service_description_checklist.sql
-- Apply via mcp__cc-supabase__apply_migration (name: recurring_service_description_checklist)
--
-- Optional per-recurring-service task description + checklist items. When set,
-- the provisioner writes the description onto each created task and adds a
-- checklist with these items (via the ClickUp Checklists API) — so recurring
-- tasks carry standing instructions + a QC checklist without a ClickUp template.

alter table public.retainer_recurring_services
  add column if not exists task_description text,
  add column if not exists checklist_items text[] not null default '{}';
