-- 0163_a_recurring_service_can_be_paused.sql
-- Apply via mcp__cc-supabase__apply_migration (name: a_recurring_service_can_be_paused)
--
-- Lisa, 2026-09-08: "set them to 0 occurrences, agreed lets not mess with
-- history." There was no way to do that. Both
--   retainer_recurring_services_occurrences_per_month_check  (> 0)
--   retainer_recurring_services_points_per_occurrence_check  (> 0)
-- refuse a zero, and they are right to: a recurring service that produces
-- nothing is not a recurring service, and a nullable "0 occurrences" would be a
-- second, silent way of saying stopped.
--
-- So the only way to stop one was to DELETE it — which is what
-- update-retainer-services does today — and `provisioned_tasks.recurring_service_id`
-- is NOT NULL with ON DELETE CASCADE, so deleting takes the record of
-- everything that service ever provisioned with it. Past months' Scheduled and
-- Completed drop retroactively. That is a bad trade for "stop making this task",
-- and it is exactly the history Lisa asked not to disturb.
--
-- Hence a third state. `paused_at` stops the provisioner and changes nothing
-- else: the service stays on the retainer, its past tasks stay attached to it,
-- and unpausing is setting one column back to null.
--
-- The live reason it exists: four "Ultimate Guide" services, 26 hours a month
-- between Trellidor UK's Business Plan retainer (20h of a 26h retainer) and
-- Dovetail's SEO retainer (6h of a 7.08h one — the whole of that retainer's
-- 180% over-scheduling). They are a ONE-OFF series being re-issued every month:
-- the same five guides, by name, appear in July, August and September.
--
-- Only ONE reader has to care — provision-retainer-period, which is the only
-- thing that creates tasks. Everything else that reads this table
-- (useRetainerServices, useRetainerSubItems, scope-allowances,
-- sync-clickup-actuals) is reading what exists, and a paused service still
-- exists.

alter table public.retainer_recurring_services
  add column if not exists paused_at timestamptz;

comment on column public.retainer_recurring_services.paused_at is
  'Set = the provisioner skips this service; null = it runs. The alternative to deleting a recurring service, which cascades away its provisioned_tasks and rewrites past months. Only provision-retainer-period reads it — a paused service is still a real service everywhere else.';
