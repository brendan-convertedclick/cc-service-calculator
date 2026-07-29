-- Two-stage extension approval + information requests.
--
-- Every extension that needs a human now goes to the admin (Lisa) leg first.
-- An admin reject is terminal — it never reaches the owner. An admin approve
-- on an owner-tier row promotes it to `pending_owner` instead of executing.
-- `status` is the sole authority on who acts next; `tier` only says whether an
-- owner leg exists at all (see supabase/functions/_shared/extension-logic.ts).
--
-- Approvers on either leg can also bounce a request back to the requester for
-- more information (`needs_info`). The requester's answer is written by the
-- `respond-to-info-request` edge function, never directly — RLS cannot stop a
-- staff UPDATE from also setting `admin_approved_at` and skipping the admin leg.

ALTER TABLE extension_requests
  DROP CONSTRAINT IF EXISTS extension_requests_status_check;
ALTER TABLE extension_requests
  ADD CONSTRAINT extension_requests_status_check CHECK (
    status IN ('auto_approved','pending_admin','pending_owner','needs_info','approved','rejected')
  );

ALTER TABLE extension_requests
  ADD COLUMN IF NOT EXISTS admin_approver_id uuid REFERENCES team_members(id),
  ADD COLUMN IF NOT EXISTS admin_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS info_request text,
  ADD COLUMN IF NOT EXISTS info_requested_by uuid REFERENCES team_members(id),
  ADD COLUMN IF NOT EXISTS info_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS info_response text,
  ADD COLUMN IF NOT EXISTS info_responded_at timestamptz;

-- Admin may act on owner-tier rows, but only while the row is still in the
-- admin leg. Once promoted to `pending_owner` only the owner can move it —
-- this is the DB-level half of "always through Lisa first, then Brendan".
--
-- USING gates the row an admin may *pick up*; that is the guarantee. The
-- explicit WITH CHECK is required: without one Postgres reuses USING for the
-- new row too, which would reject the admin's own promotion to pending_owner.
DROP POLICY IF EXISTS extension_requests_update_admin ON extension_requests;
CREATE POLICY extension_requests_update_admin ON extension_requests
  FOR UPDATE USING (
    (
      current_team_member_role() = 'admin'
      AND status IN ('auto_approved','pending_admin','needs_info')
    )
    OR current_team_member_role() = 'owner'
  )
  WITH CHECK (
    current_team_member_role() IN ('admin','owner')
  );

COMMENT ON COLUMN extension_requests.admin_approved_at IS
  'When the admin leg signed off. Set on promotion of an owner-tier row; also '
  'decides where a needs_info answer returns to.';
COMMENT ON COLUMN extension_requests.info_request IS
  'Approver''s question back to the requester. Set alongside status=needs_info.';
