-- 0175_a_meeting_carries_its_tracked_time.sql
-- Apply via mcp__cc-supabase__apply_migration (name: a_meeting_carries_its_tracked_time)
--
-- Lisa, 2026-09-15: "next work on getting meetings to track time". A
-- meeting's ClickUp task carries time tracked like any other, but
-- internal_meeting_tasks only kept its points, so the Tracked column on
-- /retainers could never reach a person's Accounted figure (Brendan's 10h
-- of August meetings counted in points and 0h in Tracked). The sync reads
-- the task already; it now keeps time_spent as hours.
--
-- Also: 0174 exempted adopted rows from the one-per-person-per-category
-- rule for client-less rows but not the client-scoped twin, so registering
-- Finance and Admin for one person under The Converted Click collided.
-- Both indexes now ignore adopted rows.

alter table public.internal_meeting_tasks
  add column if not exists clickup_tracked_hours numeric(6,2);

comment on column public.internal_meeting_tasks.clickup_tracked_hours is
  'Time tracked on the meeting''s ClickUp task (time_spent), in hours, as of clickup_synced_at. Counted in Tracked on /retainers.';

drop index if exists public.ongoing_tasks_client_uniq;
create unique index ongoing_tasks_client_uniq
  on public.ongoing_tasks (team_member_id, client_id, time_category_id)
  where client_id is not null and archived_at is null and not adopted;
