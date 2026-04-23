-- 0017_clickup_pat_to_secret.sql
-- Apply via mcp__cc-supabase__apply_migration (name: clickup_pat_to_secret)
--
-- Drop two columns from settings:
--   - clickup_pat  → moved to Supabase Edge Function secret CLICKUP_PAT
--   - burn_sync_cron_minutes → was a no-op (cron hardcoded to */30 in 0011)
--
-- USER ACTION REQUIRED before applying: set CLICKUP_PAT in the Supabase
-- project's Edge Function secrets. The push-to-clickup and
-- sync-clickup-actuals functions read it via Deno.env.get('CLICKUP_PAT').

alter table public.settings
  drop column if exists clickup_pat,
  drop column if exists burn_sync_cron_minutes;
