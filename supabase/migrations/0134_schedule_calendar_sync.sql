-- 0133_schedule_calendar_sync.sql
--
-- Read everyone's Google Calendar four times a working day.
--
-- Hourly would be waste: a meeting's hours do not change while it is running,
-- and the only things a re-scan catches are a new invite, an RSVP change and
-- a cancellation. 07:00 picks up anything booked overnight, 11:00 and 14:00
-- catch same-day invites before they happen (so a forward-dated meeting still
-- gets its ClickUp task in time to be useful), and 17:00 closes the day.
--
-- days_back is 3, not 1: an invite accepted late, or a meeting moved after the
-- fact, changes an event that started before the last scan. Three days of
-- overlap costs nothing — every write is keyed on google_event_id — and means
-- a weekend of changes is picked up on Monday morning.
--
-- Plain headers, no auth: the function is deployed with verify_jwt=false and
-- app.anon_key is not set on this database (same pattern as
-- roll-forward-recurring-tasks-monthly).
select cron.schedule(
  'sync-calendar-meetings-workday',
  '0 5,9,12,15 * * 1-5',   -- 07:00, 11:00, 14:00, 17:00 SAST (UTC+2)
  $$
  select net.http_post(
    url := 'https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/sync-calendar-meetings',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"days_back": 3, "days_forward": 30}'::jsonb
  ) as request_id;
  $$
);
