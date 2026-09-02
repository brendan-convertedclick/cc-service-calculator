-- 0149_client_raised_items.sql
-- Apply via mcp__cc-supabase__apply_migration (name: client_raised_items)
--
-- The list only ever ran one way. Everything on it was something WE wrote
-- down: an ask, a question we asked, a commitment we recorded, an idea we
-- parked. A client holding a link could answer, decide and reply — but the
-- two things they most want to start themselves had nowhere to go, so they
-- went to email, where the list cannot see them.
--
--   A QUESTION THEY ASK US is a question owed by us. It reuses item_type
--   'question' and sets owed_by='us', which is why owed_by_type_chk widens by
--   exactly one value: the shape already exists, only the direction is new.
--   It lands in "With us" on their page with no buttons — a question you asked
--   is not a question you answer.
--
--   AN EVENT is a date in their world: a launch, a sale, a trade show, an
--   office move. It is the one row on this table that nobody has to act on,
--   and that is precisely what makes it dangerous next to rows that are all
--   about who owes what. So it gets its OWN state.
--
-- WHY state='noted' AND NOT 'pending'. Every count, clock and control on this
-- feature is written as `state = 'pending'` — the waiting counts, the overdue
-- maths, the queue's quick-approve, the decide guard in the edge function. A
-- pending event would be silently wrong in all of them: the day after a launch
-- date the staff table would show it as late, and the API would accept an
-- Approve on it. A distinct state makes every one of those correct by default
-- and leaves exactly three places that must know about events on purpose:
-- which bucket they render in, that they are skipped in the email counts, and
-- that they sort by date. That is the same trade 0148 made for 'parked'.
--
-- The pairing is locked both ways (client_approvals_event_state_chk): an event
-- is always noted, and nothing but an event is ever noted. An event therefore
-- cannot be settled and has no decision to make — a wrong date is a delete,
-- not a state change.
--
-- Additive only: no DROP of data, no destructive ALTER.

alter table public.client_approvals
  add column if not exists raised_by      text not null default 'us',
  add column if not exists raised_by_name text;

alter table public.client_approvals drop constraint if exists client_approvals_raised_by_chk;
alter table public.client_approvals
  add constraint client_approvals_raised_by_chk
  check (raised_by in ('us', 'client'));

alter table public.client_approvals drop constraint if exists client_approvals_state_chk;
alter table public.client_approvals
  add constraint client_approvals_state_chk
  check (state in ('pending', 'parked', 'noted', 'approved', 'changes_requested'));

alter table public.client_approvals drop constraint if exists client_approvals_item_type_chk;
alter table public.client_approvals
  add constraint client_approvals_item_type_chk
  check (item_type in ('brief', 'question', 'agreement', 'idea', 'event'));

-- Noted joins pending and parked on the undecided side: nothing was decided,
-- so there is no stamp.
alter table public.client_approvals drop constraint if exists client_approvals_decided_chk;
alter table public.client_approvals
  add constraint client_approvals_decided_chk
  check ((state in ('pending', 'parked', 'noted')) = (decided_at is null));

-- A question the client asked is owed by us. Nothing else changes: a sign-off
-- we owe ourselves is still nonsense, and an event is always theirs.
alter table public.client_approvals drop constraint if exists client_approvals_owed_by_type_chk;
alter table public.client_approvals
  add constraint client_approvals_owed_by_type_chk
  check (owed_by = 'client' or item_type in ('agreement', 'idea', 'question'));

-- See the header: the state and the type are locked to each other.
alter table public.client_approvals drop constraint if exists client_approvals_event_state_chk;
alter table public.client_approvals
  add constraint client_approvals_event_state_chk
  check ((item_type = 'event') = (state = 'noted'));

-- A date is the entire content of an event. One without a date is a note
-- nobody can put on a calendar.
alter table public.client_approvals drop constraint if exists client_approvals_event_date_chk;
alter table public.client_approvals
  add constraint client_approvals_event_date_chk
  check (item_type <> 'event' or due_date is not null);

comment on column public.client_approvals.raised_by is
  'Who put this on the list: us, or the client from their own review page. It is what makes the opening bubble of the thread read as theirs — a question they asked must not render as ours.';

comment on column public.client_approvals.raised_by_name is
  'The client contact who raised it, resolved SERVER-SIDE from their personal link and snapshotted like decided_by_name (0142) — never taken from the request body, and never a staff name. Null when we raised it, or on a legacy shared link where there is nobody to name.';

comment on column public.client_approvals.state is
  'pending = waiting on somebody; parked = on the list, not now (staff-only); noted = an event, a date nobody acts on; approved/changes_requested = settled. Only the settled two carry a decided_at.';

comment on column public.client_approvals.item_type is
  'brief = awaiting sign-off; question = awaiting an answer (owed_by says which way); agreement = someone committed to it; idea = worth considering, not planned (always parked); event = a date in the client''s world (always noted).';
