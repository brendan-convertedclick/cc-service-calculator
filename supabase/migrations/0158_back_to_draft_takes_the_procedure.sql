-- 0158_back_to_draft_takes_the_procedure.sql
-- Apply via mcp__cc-supabase__apply_migration (name: back_to_draft_takes_the_procedure)
--
-- "Back to draft" now means the PROCEDURE, not one row of its history.
--
-- 0147 took exactly the revision it was handed back to draft. That is not what
-- the button claims to do, because a procedure can have more than one open
-- revision at a time: a proposal that was never decided still sits in
-- 'proposed' underneath a later published one. Taking the published revision
-- back left that older proposal open, so the procedure carried on reading
-- "In review" in the systems list, and `publish_system_revision` would still
-- accept it — a stale snapshot could be approved back into force after
-- somebody had deliberately pulled the procedure apart. As at this migration
-- ten published procedures and two already-draft ones are in that shape, and
-- the two draft ones could not be fixed from the UI at all: the Tasks-pane
-- button reads the newest revision, saw 'draft', and hid itself.
--
-- So the set is resolved from the system, not from the argument: every
-- revision of that procedure in 'proposed', 'changes_requested' or 'published'
-- goes to draft together, and `current_revision_id` is cleared unconditionally
-- because whatever it pointed at is in that set.
--
-- Unchanged, and still the point of the function: **carry the people, never
-- the `approved_at`**. Every stamp across every revision in the set is
-- cleared, and every approver row survives. 'superseded' is still refused —
-- it is history, and reopening it would fork the procedure into two live
-- versions of the past.
--
-- Signature unchanged: the frontend still hands it one revision id.

create or replace function public.system_revision_back_to_draft(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_system_id uuid;
  v_state     text;
  v_ids       uuid[];
begin
  -- Any team member, deliberately — no role check. The one admin act in the
  -- systems library is PUBLISHING; taking something back to be worked on is
  -- not an approval, it is the opposite of one.
  if current_team_member_role() is null then
    raise exception 'system_revision_back_to_draft: sign in as a team member';
  end if;

  select system_id, state into v_system_id, v_state
  from system_revisions
  where id = p_revision_id;

  if v_system_id is null then
    raise exception 'system_revision_back_to_draft: revision % not found', p_revision_id;
  end if;

  if v_state = 'superseded' then
    raise exception 'system_revision_back_to_draft: revision % has been replaced — take the current revision back instead', p_revision_id;
  end if;

  -- The whole procedure, not the argument. The named revision being a draft
  -- already is no longer a reason to refuse: that is exactly the shape where
  -- an older proposal is the thing still holding the procedure open.
  select array_agg(id) into v_ids
  from system_revisions
  where system_id = v_system_id
    and state in ('proposed', 'changes_requested', 'published');

  if v_ids is null then
    raise exception 'system_revision_back_to_draft: nothing to reopen — this procedure is already a draft';
  end if;

  update system_revision_approvals
  set approved_at = null
  where revision_id = any(v_ids)
    and approved_at is not null;

  update system_revisions
  set state = 'draft',
      approved_by = null,
      approved_at = null
  where id = any(v_ids);

  -- Nothing is approved afterwards, and the superseded predecessor is
  -- deliberately not resurrected: publish_system_revision requires 'proposed',
  -- so there is no legal path back for that row, and silently promoting an
  -- older version would change what the team is told to follow without anyone
  -- deciding to.
  update system_definitions
  set current_revision_id = null
  where id = v_system_id;
end;
$$;

comment on function public.system_revision_back_to_draft(uuid) is
  'Take a whole procedure back to draft, from the revision the caller names. Every revision of that system in proposed, changes_requested or published becomes draft, every approved_at on their system_revision_approvals is cleared (the rows, and so the names, survive) and system_definitions.current_revision_id is cleared. Any authenticated team member. Refuses a superseded revision.';

revoke execute on function public.system_revision_back_to_draft(uuid) from public;
grant execute on function public.system_revision_back_to_draft(uuid) to authenticated;
