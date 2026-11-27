-- The half-hourly sync re-checks only the last 21 days of ClickUp time
-- entries, but Rize rewrites older time under new ids, and because a brief's
-- hours are the higher of ClickUp's total and the logged entries (0214) a
-- stale duplicate over-bills. A 180-day pass runs every Sunday and again on
-- the 19th, the day before the ad hoc invoice run. Times are UTC (03:15 SAST),
-- off the :00/:30 marks the half-hourly job uses.
select cron.schedule('sync-clickup-actuals-180d-weekly', '15 1 * * 0', $$
  select net.http_post(
    url := 'https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/sync-clickup-actuals',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"time_entry_days": 180}'::jsonb
  );
$$);
select cron.schedule('sync-clickup-actuals-180d-before-invoice', '15 1 19 * *', $$
  select net.http_post(
    url := 'https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/sync-clickup-actuals',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"time_entry_days": 180}'::jsonb
  );
$$);
