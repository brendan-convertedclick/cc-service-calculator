-- 0137: "Requested changes" is its own revision state.
--
-- "Request changes" used to drop a proposed revision back to 'draft', which
-- made a declined revision indistinguishable from one that had never been
-- sent to anyone — the list and the detail page both read "Draft" on a row
-- someone had already reviewed and left notes on. It is still terminal for
-- that row (the fix goes out as the next revision, so sign-offs can never
-- ride on a different snapshot); it just says so now.
--
-- It joins draft/proposed on the RLS side: anyone authenticated may write
-- it, and only published/superseded stay admin/owner-only.

alter table public.system_revisions drop constraint system_revisions_state_check;
alter table public.system_revisions add constraint system_revisions_state_check
  check (state in ('draft', 'proposed', 'changes_requested', 'published', 'superseded'));

drop policy system_revisions_edit on public.system_revisions;
create policy system_revisions_edit on public.system_revisions
  for update to authenticated
  using (
    state in ('draft', 'proposed', 'changes_requested')
    or current_team_member_role() in ('admin', 'owner')
  )
  with check (
    state in ('draft', 'proposed', 'changes_requested')
    or current_team_member_role() in ('admin', 'owner')
  );

drop policy system_revisions_propose on public.system_revisions;
create policy system_revisions_propose on public.system_revisions
  for insert to authenticated
  with check (
    state in ('draft', 'proposed', 'changes_requested')
    or current_team_member_role() in ('admin', 'owner')
  );

-- Backfill: every existing 'draft' revision row got there via "Request
-- changes". A revision is only ever inserted as 'proposed' (useProposeRevision
-- is the one writer), so a draft row with a proposed_at is by definition one
-- that was sent out and sent back. All 3 rows on prod at time of writing.
update public.system_revisions
set state = 'changes_requested'
where state = 'draft' and proposed_at is not null;
