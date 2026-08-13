-- 0121_process_steps_default_checklist_item.sql
-- Apply via mcp__cc-supabase__apply_migration (name: process_steps_default_checklist_item)
--
-- A new step is a checklist item unless someone says otherwise: procedures are
-- authored as "the things one person ticks off", not as a fan of sibling
-- ClickUp tasks. Only the column default moves — existing steps keep whatever
-- they were set to.

alter table process_steps
  alter column materialise_as set default 'checklist_item'::materialise_mode;
