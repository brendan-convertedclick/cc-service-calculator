-- 0146_client_activity_status_changes.sql
-- Applied via mcp__cc-supabase__apply_migration (name: client_activity_status_changes)
--
-- A status change is a thing that happened, so it belongs on the timeline next
-- to the messages rather than being inferred from the row's current state.
-- Inferring gives you the latest value and nothing about the journey: who
-- reopened it, when, and whether anyone said why.
--
-- kind='status' rows carry from_state/to_state instead of text. body becomes
-- the OPTIONAL reason for the change, which is why it stops being NOT NULL —
-- and why the length check now only applies to the kinds whose whole content
-- is the text.
--
-- Additive only: no DROP of data, no destructive ALTER.

alter table public.client_activity
  add column if not exists from_state text,
  add column if not exists to_state   text;

alter table public.client_activity alter column body drop not null;

alter table public.client_activity drop constraint if exists client_activity_kind_chk;
alter table public.client_activity
  add constraint client_activity_kind_chk
  check (kind in ('message', 'note', 'client_message', 'status'));

alter table public.client_activity drop constraint if exists client_activity_body_chk;
alter table public.client_activity
  add constraint client_activity_body_chk
  check (
    case
      when kind = 'status' then body is null or length(btrim(body)) > 0
      else body is not null and length(btrim(body)) > 0
    end
  );

-- A status row without a destination says nothing at all.
alter table public.client_activity drop constraint if exists client_activity_status_chk;
alter table public.client_activity
  add constraint client_activity_status_chk
  check (kind <> 'status' or to_state is not null);

comment on column public.client_activity.to_state is
  'kind=status only: the state it was moved TO. from_state is where it came from, so the timeline can say "moved back to waiting on client" rather than just naming the destination.';

comment on column public.client_activity.body is
  'The text, for message/client_message/note. For kind=status it is the optional reason someone gave for the change.';
