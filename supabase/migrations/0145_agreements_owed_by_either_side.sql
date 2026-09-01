-- 0145_agreements_owed_by_either_side.sql
-- Applied via mcp__cc-supabase__apply_migration (name: agreements_owed_by_either_side)
--
-- An agreement has two sides. client_approvals could only hold one.
--
-- 'agreement' arrived in 0141 as "something the client committed to", which
-- covered half of what actually gets agreed in a meeting. The other half is
-- ours: we said we would send the deck by Tuesday. Those belong on the same
-- record for the same reason both halves of a thread do — the client should
-- see what we owe them, and "who owes what" is one list or it is no list.
--
-- owed_by is what the sign-off page reads to decide whose court an agreement
-- sits in. Everything else (a brief for sign-off, a question) is by definition
-- the client's move, which is why the default is 'client' and why nothing else
-- ever sets this column.
--
-- brief_id already exists and is reused as the link to the task an agreement
-- of ours was turned into: the constraint below is widened rather than a
-- second column added, so "what did this become" has one answer.
--
-- Additive only: no DROP, no destructive ALTER.

alter table public.client_approvals
  add column if not exists owed_by text not null default 'client';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_approvals_owed_by_chk'
  ) then
    alter table public.client_approvals
      add constraint client_approvals_owed_by_chk
      check (owed_by in ('client', 'us'));
  end if;

  -- Only an agreement can be ours. A sign-off we owe ourselves is nonsense,
  -- and a question we ask ourselves is a note.
  if not exists (
    select 1 from pg_constraint where conname = 'client_approvals_owed_by_type_chk'
  ) then
    alter table public.client_approvals
      add constraint client_approvals_owed_by_type_chk
      check (owed_by = 'client' or item_type = 'agreement');
  end if;
end $$;

comment on column public.client_approvals.owed_by is
  'Whose move an agreement is: client = they committed to it, us = we did. Drives which bucket it lands in on the client page and who gets the button to close it. Always client for briefs and questions — see client_approvals_owed_by_type_chk.';

comment on column public.client_approvals.brief_id is
  'For a brief item: where the sign-off came from. For an agreement of ours: the brief it was turned into, which carries the ClickUp task. Null until one exists.';
