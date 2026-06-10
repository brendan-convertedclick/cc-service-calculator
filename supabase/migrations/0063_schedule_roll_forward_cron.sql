-- roll-forward-recurring-tasks was never scheduled (left as an operator
-- follow-up when the function shipped), so monthly retainer re-provisioning
-- and the due-date advance only ever ran on demand. Schedule it for 00:05 UTC
-- on the 1st of each month — the UTC month has already rolled over then, so
-- the function's period/month-end math lands on the new period.
--
-- Plain headers, no auth: the function is deployed with verify_jwt=false and
-- app.anon_key is not set on this database (same pattern as
-- create-recurring-tasks-daily).
select cron.schedule(
  'roll-forward-recurring-tasks-monthly',
  '5 0 1 * *',
  $$
  select net.http_post(
    url := 'https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/roll-forward-recurring-tasks',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) as request_id;
  $$
);
