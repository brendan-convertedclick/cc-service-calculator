-- 0068_recurring_service_occurrence_labels.sql
-- Apply via mcp__cc-supabase__apply_migration (name: recurring_service_occurrence_labels)
--
-- Optional per-occurrence labels for a recurring service — e.g. one website name
-- per task ("Safeload", "Pallchem", …). The provisioner names occurrence i with
-- labels[i], so per-website task names persist month to month instead of relying
-- on manual ClickUp renames. NULL/empty = the existing generic naming.

alter table public.retainer_recurring_services
  add column if not exists occurrence_labels text[] not null default '{}';
