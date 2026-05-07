-- 0026_settings_unallocated_ai.sql
-- Apply via mcp__cc-supabase__apply_migration (name: settings_unallocated_ai)
--
-- Stores the ClickUp task ID where the Stop hook posts AI usage when
-- it can't resolve a project (no .cc-project file, no git remote match,
-- session_id not previously seen). Settable via the Settings page.

alter table public.settings
  add column if not exists unallocated_ai_clickup_task_id text;
