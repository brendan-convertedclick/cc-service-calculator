-- 0102_services_checklist_items.sql
-- Apply via mcp__cc-supabase__apply_migration (name: services_checklist_items)
--
-- Default checklist for a catalog service. When set, any ClickUp task
-- created from this service (quote push, quick brief) gets a checklist with
-- these items (via the ClickUp Checklists API) — same mechanism as
-- retainer_recurring_services.checklist_items (0070), just at the reusable
-- service-catalog level instead of per-retainer-instance.

alter table services
  add column if not exists checklist_items text[] not null default '{}';
