-- 0093_internal_meetings.sql
-- Staff can schedule an internal meeting from /staff: pick a client (required),
-- optional project, internal attendees, date/time. This writes the meeting +
-- attendee rows; the manage-internal-meeting edge function (service role)
-- fans that out to a Google Calendar event (with Meet link) and a ClickUp
-- task in the internal list so the time counts as overhead, not billable.
--
-- Also adds google_user_tokens: per-team-member Google OAuth refresh tokens
-- captured from the Supabase Auth Google sign-in (same login staff already
-- use), so each meeting is organised from the organiser's own calendar.

-- ── google_user_tokens ──────────────────────────────────────────────────
-- SECURITY: these are server-only credentials, same posture as
-- 0080_clickup_user_tokens.sql. RLS is enabled with NO policy for the
-- `authenticated` role, so the browser (anon/authenticated JWT) can never
-- read or write this table — every token read/write goes through the
-- service role inside edge functions (google-token, manage-internal-meeting).
-- The frontend only ever sees connection *status*
-- (via google-token?action=status), never the token itself.

create table if not exists google_user_tokens (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null unique references team_members(id) on delete cascade,
  google_email text,
  access_token text,
  refresh_token text not null,
  expires_at timestamptz,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table google_user_tokens enable row level security;

-- Intentionally NO policy for the `authenticated` role: RLS with no matching
-- policy denies all access to non-service-role clients. Only the service
-- role (edge functions) may touch this table.

comment on table google_user_tokens is
  'Per-team-member Google OAuth refresh tokens (calendar.events scope), captured from the Supabase Auth Google sign-in. Service-role only — RLS enabled with no authenticated policy so the browser can never read refresh_token.';

create or replace function google_user_tokens_set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists google_user_tokens_updated_at on google_user_tokens;
create trigger google_user_tokens_updated_at
  before update on google_user_tokens
  for each row execute function google_user_tokens_set_updated_at();

-- ── internal_meetings ────────────────────────────────────────────────────

create table if not exists internal_meetings (
  id uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references team_members(id),
  client_id uuid not null references clients(id),
  project_id uuid references projects(id),
  title text not null,
  agenda text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  google_event_id text,
  google_calendar_email text,
  google_meet_url text,
  google_html_link text,
  google_sync_error text,
  clickup_task_id text,
  clickup_task_url text,
  clickup_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_meetings_time_order check (ends_at > starts_at)
);

create index if not exists internal_meetings_organiser_id_idx on internal_meetings(organiser_id);
create index if not exists internal_meetings_client_id_idx on internal_meetings(client_id);
create index if not exists internal_meetings_starts_at_idx on internal_meetings(starts_at);
create index if not exists internal_meetings_clickup_task_id_idx on internal_meetings(clickup_task_id);

-- updated_at trigger
create or replace function internal_meetings_set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists internal_meetings_updated_at on internal_meetings;
create trigger internal_meetings_updated_at
  before update on internal_meetings
  for each row execute function internal_meetings_set_updated_at();

comment on table internal_meetings is
  'Staff-scheduled internal meetings (standups, syncs, etc). Mirrored to a Google Calendar event (with Meet link) and a ClickUp task in settings.clickup_internal_list_id so the time is tracked as overhead, not billable.';

-- ── internal_meeting_attendees ──────────────────────────────────────────

create table if not exists internal_meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references internal_meetings(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  unique (meeting_id, team_member_id)
);

create index if not exists internal_meeting_attendees_meeting_id_idx
  on internal_meeting_attendees(meeting_id);
create index if not exists internal_meeting_attendees_team_member_id_idx
  on internal_meeting_attendees(team_member_id);

comment on table internal_meeting_attendees is
  'Attendee list for an internal_meetings row. Determines both calendar invitees and RLS visibility.';

-- ── RLS ──────────────────────────────────────────────────────────────────
--
-- internal_meetings.SELECT needs to know "is the caller an attendee of this
-- meeting", which lives in internal_meeting_attendees — and
-- internal_meeting_attendees.SELECT in turn needs to know "is this meeting
-- visible to the caller", which lives in internal_meetings. Querying each
-- table's own policy from the other's policy is a direct RLS cycle
-- (verified empirically: PostgreSQL raises `42P17 infinite recursion
-- detected in policy` for exactly this mutual-reference shape). Break the
-- cycle with one SECURITY DEFINER helper — mirroring the existing
-- current_team_member_id()/current_team_member_role() helpers from 0052 —
-- that reads internal_meeting_attendees directly, bypassing that table's
-- RLS, so internal_meetings' policy no longer re-enters attendees' policy.
-- internal_meeting_attendees' own policies may still safely reference
-- internal_meetings, because that direction no longer loops back.

create or replace function is_meeting_attendee(p_meeting_id uuid) returns boolean as $$
  select exists (
    select 1 from internal_meeting_attendees
    where meeting_id = p_meeting_id
      and team_member_id = current_team_member_id()
  );
$$ language sql stable security definer;

alter table internal_meetings enable row level security;

drop policy if exists internal_meetings_select on internal_meetings;
create policy internal_meetings_select on internal_meetings
  for select using (
    organiser_id = current_team_member_id()
    or is_meeting_attendee(id)
    or current_team_member_role() in ('admin', 'owner')
  );

drop policy if exists internal_meetings_insert_own on internal_meetings;
create policy internal_meetings_insert_own on internal_meetings
  for insert with check (
    organiser_id = current_team_member_id()
    or current_team_member_role() in ('admin', 'owner')
  );

drop policy if exists internal_meetings_update on internal_meetings;
create policy internal_meetings_update on internal_meetings
  for update using (
    organiser_id = current_team_member_id()
    or current_team_member_role() in ('admin', 'owner')
  );

drop policy if exists internal_meetings_delete on internal_meetings;
create policy internal_meetings_delete on internal_meetings
  for delete using (
    organiser_id = current_team_member_id()
    or current_team_member_role() in ('admin', 'owner')
  );

alter table internal_meeting_attendees enable row level security;

-- Visible: same rule as the parent meeting's own SELECT policy, expressed
-- as an exists-subquery on internal_meetings (safe direction — see comment
-- above; internal_meetings' policy does not read this table directly).
drop policy if exists internal_meeting_attendees_select on internal_meeting_attendees;
create policy internal_meeting_attendees_select on internal_meeting_attendees
  for select using (
    exists (
      select 1 from internal_meetings m
      where m.id = internal_meeting_attendees.meeting_id
        and (
          m.organiser_id = current_team_member_id()
          or is_meeting_attendee(m.id)
          or current_team_member_role() in ('admin', 'owner')
        )
    )
  );

-- Editable: only the organiser (or admin/owner) may add/remove attendees —
-- mirrors internal_meetings' UPDATE policy, not its (broader) SELECT policy.
drop policy if exists internal_meeting_attendees_insert on internal_meeting_attendees;
create policy internal_meeting_attendees_insert on internal_meeting_attendees
  for insert with check (
    exists (
      select 1 from internal_meetings m
      where m.id = internal_meeting_attendees.meeting_id
        and (
          m.organiser_id = current_team_member_id()
          or current_team_member_role() in ('admin', 'owner')
        )
    )
  );

drop policy if exists internal_meeting_attendees_delete on internal_meeting_attendees;
create policy internal_meeting_attendees_delete on internal_meeting_attendees
  for delete using (
    exists (
      select 1 from internal_meetings m
      where m.id = internal_meeting_attendees.meeting_id
        and (
          m.organiser_id = current_team_member_id()
          or current_team_member_role() in ('admin', 'owner')
        )
    )
  );
