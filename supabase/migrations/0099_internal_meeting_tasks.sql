-- 0099_internal_meeting_tasks.sql
--
-- ClickUp's native Sprint Points field splits points PER ASSIGNEE on a task —
-- confirmed empirically 2026-07-30: a 2-point meeting task with two assignees
-- credited only one of them, the other showed "- pt". A single shared task
-- can't track each attendee's meeting time, so each person now gets their own
-- ClickUp task instead of being co-assigned to one.
--
-- internal_meetings.clickup_task_id/url/sync_error stay as the ORGANISER's
-- own task (existing frontend links read that column). This table adds one
-- row per person (organiser included, for a uniform update/cancel loop) so
-- manage-internal-meeting can create/update/cancel each person's task
-- independently.

create table if not exists internal_meeting_tasks (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references internal_meetings(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  clickup_task_id text,
  clickup_task_url text,
  clickup_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, team_member_id)
);

create index if not exists internal_meeting_tasks_meeting_id_idx
  on internal_meeting_tasks(meeting_id);
create index if not exists internal_meeting_tasks_clickup_task_id_idx
  on internal_meeting_tasks(clickup_task_id);

comment on table internal_meeting_tasks is
  'One ClickUp task per person on an internal_meetings row (organiser included). ClickUp splits Sprint Points per-assignee on a shared task, so each person needs their own task to get full credit.';

create or replace function internal_meeting_tasks_set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists internal_meeting_tasks_updated_at on internal_meeting_tasks;
create trigger internal_meeting_tasks_updated_at
  before update on internal_meeting_tasks
  for each row execute function internal_meeting_tasks_set_updated_at();

alter table internal_meeting_tasks enable row level security;

-- Same visibility rule as the parent meeting: organiser, any attendee, or
-- admin/owner. Written only by the service role (manage-internal-meeting).
drop policy if exists internal_meeting_tasks_select on internal_meeting_tasks;
create policy internal_meeting_tasks_select on internal_meeting_tasks
  for select using (
    exists (
      select 1 from internal_meetings m
      where m.id = internal_meeting_tasks.meeting_id
        and (
          m.organiser_id = current_team_member_id()
          or is_meeting_attendee(m.id)
          or current_team_member_role() in ('admin', 'owner')
        )
    )
  );
