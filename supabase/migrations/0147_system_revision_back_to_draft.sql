-- 0147_system_revision_back_to_draft.sql
-- Apply via mcp__cc-supabase__apply_migration (name: system_revision_back_to_draft)
--
-- Anyone can put a revision back to Draft.
--
-- Until now every forward door existed and no door went back. A revision sent
-- for review was stuck In review until somebody with an admin role acted on
-- it; one that came back as Requested changes was terminal; an Approved one
-- could only be replaced by writing the next revision. The people who write
-- and run these procedures are staff, so the person who noticed the mistake
-- was routinely the one person who could not fix it.
--
-- THIS REPLACES A DELIBERATE INVARIANT, so it is worth being explicit about
-- what protected it. The old rule was "a revision never re-opens", and the
-- reason was `system_revision_approvals`: those rows hang off a revision id,
-- so re-opening a signed-off revision would let edited content ride on
-- sign-offs that were recorded against a different snapshot. Somebody agreed
-- to procedure A and would be shown as having agreed to procedure B.
--
-- The invariant is kept — the door is just built so it cannot be violated:
-- going back to Draft CLEARS EVERY `approved_at` on the way. Nobody is ever
-- shown as having signed something they did not read. The approver rows
-- themselves survive, which is the same rule the Send-for-review dialog
-- already follows: **carry the people, never the `approved_at`**.
--
-- WHY AN RPC AND NOT A WIDER RLS POLICY. `system_revisions_edit` (0118/0137)
-- deliberately refuses staff any UPDATE on a `published` row. Loosening it so
-- they could set state='draft' would also let them edit published *content*
-- in place, and a published revision that can be quietly rewritten is not
-- evidence of anything — which is the whole reason the approvals system
-- exists. SECURITY DEFINER grants exactly this one transition and nothing
-- else, the same shape as publish_system_revision going the other way.
--
-- Additive only: no DROP of anything that exists, no policy change.

create or replace function public.system_revision_back_to_draft(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_system_id uuid;
  v_state     text;
begin
  -- Any team member, deliberately — no role check. The one admin act in the
  -- systems library is PUBLISHING; taking something back to be worked on is
  -- not an approval, it is the opposite of one. Note this does mean a staff
  -- member can un-approve a live procedure. That is the intent: they are the
  -- ones running it, so they are the ones who find it wrong. Restricting the
  -- published case is a single added condition below if that changes.
  if current_team_member_role() is null then
    raise exception 'system_revision_back_to_draft: sign in as a team member';
  end if;

  select system_id, state into v_system_id, v_state
  from system_revisions
  where id = p_revision_id;

  if v_system_id is null then
    raise exception 'system_revision_back_to_draft: revision % not found', p_revision_id;
  end if;

  if v_state = 'draft' then
    raise exception 'system_revision_back_to_draft: revision % is already a draft', p_revision_id;
  end if;

  -- 'superseded' is history, not a state anything comes back from. It was
  -- approved and then replaced, so reopening it would fork the procedure into
  -- two live versions of the past. Work on the current one instead.
  if v_state = 'superseded' then
    raise exception 'system_revision_back_to_draft: revision % has been replaced — take the current revision back instead', p_revision_id;
  end if;

  -- The whole safety of this function. Clear the stamps, keep the people.
  update system_revision_approvals
  set approved_at = null
  where revision_id = p_revision_id
    and approved_at is not null;

  update system_revisions
  set state = 'draft',
      approved_by = null,
      approved_at = null
  where id = p_revision_id;

  -- Un-publishing leaves the procedure with NOTHING currently approved, and
  -- deliberately does not resurrect the revision this one superseded. There
  -- is no legal path back to published for that row anyway —
  -- publish_system_revision requires 'proposed' — and silently promoting an
  -- older version because a newer one was pulled would change what the team
  -- is told to follow without anyone deciding to. The history stays readable;
  -- the procedure simply reads as Draft until a revision is approved again.
  update system_definitions
  set current_revision_id = null
  where id = v_system_id
    and current_revision_id = p_revision_id;
end;
$$;

comment on function public.system_revision_back_to_draft(uuid) is
  'Put a revision back to draft from proposed, changes_requested or published. Any authenticated team member. Clears every approved_at on its system_revision_approvals (the rows, and so the names, survive) and clears system_definitions.current_revision_id when it pointed here. Refuses draft and superseded.';

-- SECURITY DEFINER runs as the owner, so the grant is the only gate. Postgres
-- grants EXECUTE to PUBLIC by default; take that back before handing it out.
revoke execute on function public.system_revision_back_to_draft(uuid) from public;
grant execute on function public.system_revision_back_to_draft(uuid) to authenticated;
