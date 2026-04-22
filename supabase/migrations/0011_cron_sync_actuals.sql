-- 0011_cron_sync_actuals.sql
-- Apply via mcp__cc-supabase__apply_migration (name: cron_sync_actuals)
--
-- Schedules sync-clickup-actuals every 30 minutes via pg_cron + pg_net.
-- Cadence is fixed at */30 here — settings.burn_sync_cron_minutes does NOT
-- automatically reschedule (a Phase 1.x task can add that). To change
-- cadence manually: run `select cron.alter_job(...)` against this jobname.
--
-- The edge function is deployed with --no-verify-jwt so the anon publishable
-- key is sufficient to authorise the HTTPS POST. The function itself gates
-- on settings.clickup_enabled.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Drop any previous schedule with the same name so re-running this migration
-- is idempotent (pg_cron.schedule errors on duplicate jobname).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-clickup-actuals-30min') then
    perform cron.unschedule('sync-clickup-actuals-30min');
  end if;
end $$;

select cron.schedule(
  'sync-clickup-actuals-30min',
  '*/30 * * * *',
  $cron$
  select net.http_post(
    url := 'https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/sync-clickup-actuals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_UcaLJ0sbL5jRDntcT5r-EA_KxL6hxfp',
      'apikey', 'sb_publishable_UcaLJ0sbL5jRDntcT5r-EA_KxL6hxfp'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
