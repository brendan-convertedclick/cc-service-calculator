-- 0148_parked_items_and_ideas.sql
-- Apply via mcp__cc-supabase__apply_migration (name: parked_items_and_ideas)
--
-- Things worth doing that nobody is doing yet.
--
-- The sign-off list has only ever held work that is waiting on somebody: an
-- ask, a question, a commitment, each with a court and a clock. What it could
-- not hold is the third thing that comes out of every client meeting — the
-- idea that is worth considering but not now. Today those live in someone's
-- head, and the whole point of this page is that nothing does.
--
-- TWO ADDITIONS, AND THEY ARE DIFFERENT SHAPES:
--
--   state = 'parked'   an item that exists but whose time is not right. It
--                      still has a side (owed_by), it just has no clock: no
--                      chasing, no overdue, no "waiting on this client" count.
--                      Parking is the opposite of a decision, so decided_at
--                      stays null — hence the widened decided_chk below.
--
--   item_type = 'idea' the thing that had no home at all. A brief needs a
--                      brief_id, a question emails the moment it is written
--                      and an agreement needs the date it was agreed on — all
--                      three constraints are load-bearing and none of them fit
--                      "we should probably look at their Google Business
--                      listing at some point". An idea carries none of that.
--
-- AN IDEA IS ALWAYS PARKED (client_approvals_idea_parked_chk). It is what
-- makes 'idea' safe: the client-facing function degrades an unrecognised
-- item_type to 'brief' so that no client ever meets an item with no way to
-- act, which means a *pending* idea would reach their page wearing Approve
-- and Request-changes buttons. The database refuses to create one. When the
-- time comes an idea is not un-parked, it is asked properly — as a question,
-- an agreement or a brief, which is the act of deciding what it actually is.
--
-- Parked rows are staff-only, filtered out in the client-review function's
-- list query and in its preview mirror.
--
-- Additive only: no DROP of data, no destructive ALTER.

alter table public.client_approvals drop constraint if exists client_approvals_state_chk;
alter table public.client_approvals
  add constraint client_approvals_state_chk
  check (state in ('pending', 'parked', 'approved', 'changes_requested'));

alter table public.client_approvals drop constraint if exists client_approvals_item_type_chk;
alter table public.client_approvals
  add constraint client_approvals_item_type_chk
  check (item_type in ('brief', 'question', 'agreement', 'idea'));

-- A decision is still a decision: state and the stamp move together. Parking
-- joins pending on the undecided side of that equation.
alter table public.client_approvals drop constraint if exists client_approvals_decided_chk;
alter table public.client_approvals
  add constraint client_approvals_decided_chk
  check ((state in ('pending', 'parked')) = (decided_at is null));

-- An idea can sit on either side — "they might want this" and "we should
-- suggest this" are both worth not forgetting — so it joins agreement as a
-- type that may be owed by us. A sign-off or a question we owe ourselves is
-- still nonsense.
alter table public.client_approvals drop constraint if exists client_approvals_owed_by_type_chk;
alter table public.client_approvals
  add constraint client_approvals_owed_by_type_chk
  check (owed_by = 'client' or item_type in ('agreement', 'idea'));

-- See the header: this is the lock that keeps an idea off a client's page.
alter table public.client_approvals drop constraint if exists client_approvals_idea_parked_chk;
alter table public.client_approvals
  add constraint client_approvals_idea_parked_chk
  check (item_type <> 'idea' or state = 'parked');

comment on column public.client_approvals.state is
  'pending = waiting on somebody; parked = on the list, not now (no clock, no chasing, staff-only); approved/changes_requested = settled. Parked and pending are both undecided — see client_approvals_decided_chk.';

comment on column public.client_approvals.item_type is
  'brief = a deliverable awaiting sign-off; question = awaiting an answer; agreement = someone committed to it; idea = worth considering, not planned. An idea is always parked (client_approvals_idea_parked_chk).';
