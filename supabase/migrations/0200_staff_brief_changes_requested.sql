-- A third answer to a staff brief besides approve and reject: send it back to
-- the submitter to edit and resubmit, so a brief that is nearly right is not
-- rebuilt from scratch. change_request is what the approver asked for; it is
-- left in place on resubmit so the approver sees what they asked for beside
-- what came back.

alter table staff_briefs drop constraint if exists staff_briefs_status_check;
alter table staff_briefs add constraint staff_briefs_status_check
  check (status in ('pending_approval','approved','rejected','changes_requested'));

alter table staff_briefs add column if not exists change_request text;

-- The submitter may edit their own brief only while it is back with them, and
-- the only state they may leave it in is back in the queue. Approval columns
-- are still written by approve-staff-brief alone, which checks status.
drop policy if exists staff_briefs_update_own_changes on staff_briefs;
create policy staff_briefs_update_own_changes on staff_briefs
  for update
  using (submitter_id = current_team_member_id() and status = 'changes_requested')
  with check (submitter_id = current_team_member_id() and status = 'pending_approval');
