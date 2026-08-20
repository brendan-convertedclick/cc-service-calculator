-- 0132_calendar_meetings.sql
--
-- "How much time did we spend on this client?" needs meetings in the answer,
-- and today Conductor only knows about the meetings it created itself. A
-- client-sent invite lands in Google Calendar and nowhere else: 46 meeting
-- ClickUp tasks exist and not one of them appears in project_actuals or
-- ongoing_actuals.
--
-- Nothing here measures time. The invite already carries it — start, end,
-- attendees, RSVP. This migration gives sync-calendar-meetings somewhere to
-- put what it reads, and gives the app one honest per-client hours figure.
--
-- Deliberately extends internal_meetings rather than adding a
-- client_meetings table. Two tables would mean two sums to add up forever,
-- and the row already carries client_id, project_id, starts_at and ends_at —
-- everything the question needs. "Internal" in the name is a historical
-- accident, not a boundary.

-- ── internal_meetings: where the row came from, and who was on the far side ──

alter table public.internal_meetings
  add column if not exists source text not null default 'conductor'
    check (source in ('conductor', 'calendar')),
  add column if not exists meeting_type text not null default 'internal'
    check (meeting_type in ('internal', 'client')),
  -- The event's real Google organiser, which for a client-sent invite is an
  -- address we do not own. organiser_id stays NOT NULL and points at a staff
  -- member (see sync-calendar-meetings' pickOrganiser) because every RLS
  -- policy and half the frontend reads it; this column carries the truth.
  add column if not exists organiser_email text,
  add column if not exists external_emails jsonb not null default '[]'::jsonb,
  add column if not exists matched_domain text,
  add column if not exists calendar_synced_at timestamptz;

comment on column public.internal_meetings.source is
  'conductor = scheduled in-app via manage-internal-meeting (we own the Google event). calendar = discovered on a staff calendar by sync-calendar-meetings (we may not own it — never patch or delete those events).';
comment on column public.internal_meetings.meeting_type is
  'client = at least one attendee outside our own email domains. internal = staff only. Both attribute to a client; this only splits the reporting.';
comment on column public.internal_meetings.matched_domain is
  'The external attendee domain that resolved to client_id, for auditing a wrong attribution back to its cause.';

-- One row per Google event. singleEvents=true means a recurring weekly WIP
-- arrives as one event per instance with its own id, so each occurrence gets
-- its own row and its own hours — which is the whole point of reading the
-- calendar rather than the series definition.
--
-- Plain, NOT partial. Conductor rows written before their Google sync (or
-- whose sync failed) carry a null google_event_id, and Postgres treats NULLs
-- as distinct by default, so a plain unique index already permits any number
-- of them. It must stay plain because a PARTIAL unique index cannot be
-- inferred by `ON CONFLICT (google_event_id)` — PostgREST has no way to send
-- the index predicate, and every upsert in sync-calendar-meetings would fail
-- with "no unique or exclusion constraint matching the ON CONFLICT
-- specification". Verified 2026-08-20: no existing row shares one, so this
-- builds clean on live data.
create unique index if not exists internal_meetings_google_event_id_idx
  on public.internal_meetings (google_event_id);

create index if not exists internal_meetings_source_idx
  on public.internal_meetings (source);

-- ── attendee RSVP ────────────────────────────────────────────────────────
--
-- Google's four responseStatus values, stored verbatim. The product rule
-- (set 2026-08-20) is that only an outright decline means "I was not there":
-- needsAction is the default state of every invite nobody has clicked, and
-- excluding it would silently drop most real meetings. tentative counts too.
--
-- Declined attendees keep their row rather than being deleted, so a later
-- change of mind is an UPDATE and the record of who was asked survives.
alter table public.internal_meeting_attendees
  add column if not exists response_status text not null default 'accepted'
    check (response_status in ('accepted', 'tentative', 'needsAction', 'declined'));

comment on column public.internal_meeting_attendees.response_status is
  'Google Calendar responseStatus. Only "declined" is treated as not-attended — see meeting_participants.';

-- ── meeting_participants ────────────────────────────────────────────────
--
-- Every person whose time a meeting consumed. Needed because the organiser is
-- NOT reliably an internal_meeting_attendees row: manage-internal-meeting
-- inserts only the picked attendees, so 16 of the first 24 meetings have an
-- organiser who appears nowhere in that table. Summing attendees alone
-- undercounts by roughly a third.
--
-- security_invoker so the caller's own RLS on internal_meetings applies:
-- admin/owner see the book, staff see the meetings they were part of.
create or replace view public.meeting_participants
  with (security_invoker = true) as
  select
    a.meeting_id,
    a.team_member_id,
    a.response_status
  from public.internal_meeting_attendees a

  union all

  -- The organiser, only when they are not already an attendee row (which
  -- would otherwise double-count them, and override their real RSVP).
  select
    m.id,
    m.organiser_id,
    'accepted'::text
  from public.internal_meetings m
  where not exists (
    select 1 from public.internal_meeting_attendees a
    where a.meeting_id = m.id
      and a.team_member_id = m.organiser_id
  );

comment on view public.meeting_participants is
  'One row per person per meeting, organiser included exactly once. The unit of meeting cost: agency time is person-hours, so a 1h meeting with three staff is 3 hours.';

grant select on public.meeting_participants to authenticated, service_role;

-- ── client_meeting_hours ────────────────────────────────────────────────
--
-- Per client, per month, how many hours of our people a client's meetings
-- consumed. Person-hours, not elapsed — an hour with three of us in the room
-- costs three hours.
--
-- Only meetings that have actually HAPPENED: a scheduled-but-unheld meeting
-- later this month would otherwise inflate the current month and make the
-- number unusable exactly when someone is looking at it. Cancelled meetings
-- and declined participants are out for the same reason.
create or replace view public.client_meeting_hours
  with (security_invoker = true) as
  select
    m.client_id,
    m.project_id,
    to_char(m.starts_at at time zone 'Africa/Johannesburg', 'YYYY-MM') as month,
    m.meeting_type,
    m.source,
    count(distinct m.id)                                              as meetings,
    count(*)                                                          as participant_slots,
    round(
      sum(extract(epoch from (m.ends_at - m.starts_at)) / 3600.0)::numeric,
      2
    )                                                                 as person_hours
  from public.internal_meetings m
  join public.meeting_participants p on p.meeting_id = m.id
  where m.status <> 'cancelled'
    and m.ends_at <= now()
    and p.response_status <> 'declined'
  group by m.client_id, m.project_id, month, m.meeting_type, m.source;

comment on view public.client_meeting_hours is
  'Per-client meeting cost in person-hours, by month. Held meetings only (ends_at in the past, not cancelled, declines excluded) so the current month is never inflated by what is merely booked.';

grant select on public.client_meeting_hours to authenticated, service_role;

-- ── pending_meeting_domains ─────────────────────────────────────────────
--
-- An external attendee domain we could not resolve to a client. NOT
-- pending_senders: that table answers "known client, unknown person" and
-- requires a client_id. This is the inverse — an unknown counterparty, no
-- client yet — so it needs its own table.
--
-- The queue is the bootstrap. Only 5 of 37 clients have a primary_domain and
-- only 3 appear in client_domains, so the first sync will resolve almost
-- nothing. Sorting this queue by hours already spent puts the highest-value
-- mappings first, and each one resolved makes every future sync better.
create table if not exists public.pending_meeting_domains (
  id                     uuid primary key default gen_random_uuid(),
  domain                 text not null unique,
  seen_count             int not null default 0,
  -- Hours we would have attributed had the domain been mapped. This is the
  -- sort key that makes the queue worth working through.
  unattributed_hours     numeric(10, 2) not null default 0,
  sample_title           text,
  sample_organiser_email text,
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  -- Set to dismiss a domain that will never be a client: suppliers, tool
  -- vendors, recruiters. Kept rather than deleted so a re-sync does not
  -- resurrect it on the next pass.
  ignored_at             timestamptz
);

create index if not exists pending_meeting_domains_open_idx
  on public.pending_meeting_domains (unattributed_hours desc)
  where ignored_at is null;

comment on table public.pending_meeting_domains is
  'External meeting attendee domains with no client mapping, ranked by the hours they would have attributed. Resolve one by writing a client_domains row, then re-sync — previously skipped events are only picked up on a later pass.';

alter table public.pending_meeting_domains enable row level security;

-- Anyone signed in may read the queue; only admin/owner may resolve or
-- dismiss, matching who is allowed to write client_domains. The sync itself
-- runs as service_role, which bypasses all of this.
drop policy if exists pending_meeting_domains_select on public.pending_meeting_domains;
create policy pending_meeting_domains_select on public.pending_meeting_domains
  for select using (true);

drop policy if exists pending_meeting_domains_write on public.pending_meeting_domains;
create policy pending_meeting_domains_write on public.pending_meeting_domains
  for all
  using (current_team_member_role() in ('admin', 'owner'))
  with check (current_team_member_role() in ('admin', 'owner'));
