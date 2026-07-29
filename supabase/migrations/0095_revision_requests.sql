-- Staff self-service revision requests: pick a client + one of their open
-- tasks + a revision stage, and (on admin approval) a new ClickUp task is
-- created with the same base name but the new revision suffix.

CREATE TABLE IF NOT EXISTS revision_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES team_members(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  parent_clickup_task_id text NOT NULL,
  parent_task_name text NOT NULL,
  revision_suffix text NOT NULL CHECK (revision_suffix IN ('DFT V2.1','DFT V2.2','REV V1.1','REV 2.1')),
  status text NOT NULL DEFAULT 'pending_admin'
    CHECK (status IN ('pending_admin','approved','rejected')),
  approver_id uuid REFERENCES team_members(id),
  approved_at timestamptz,
  rejected_reason text,
  clickup_new_task_id text,
  clickup_new_task_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revision_requests_status_idx ON revision_requests(status);
CREATE INDEX IF NOT EXISTS revision_requests_requester_idx ON revision_requests(requester_id);
CREATE INDEX IF NOT EXISTS revision_requests_parent_task_idx
  ON revision_requests(parent_clickup_task_id);

CREATE OR REPLACE FUNCTION revision_requests_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS revision_requests_updated_at ON revision_requests;
CREATE TRIGGER revision_requests_updated_at
  BEFORE UPDATE ON revision_requests
  FOR EACH ROW EXECUTE FUNCTION revision_requests_set_updated_at();

ALTER TABLE revision_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS revision_requests_select ON revision_requests;
CREATE POLICY revision_requests_select ON revision_requests
  FOR SELECT USING (
    requester_id = current_team_member_id()
    OR current_team_member_role() IN ('admin','owner')
  );

DROP POLICY IF EXISTS revision_requests_insert_own ON revision_requests;
CREATE POLICY revision_requests_insert_own ON revision_requests
  FOR INSERT WITH CHECK (
    requester_id = current_team_member_id()
  );

DROP POLICY IF EXISTS revision_requests_update_admin ON revision_requests;
CREATE POLICY revision_requests_update_admin ON revision_requests
  FOR UPDATE USING (
    current_team_member_role() IN ('admin','owner')
  );

COMMENT ON TABLE revision_requests IS 'Staff revision requests: new ClickUp task with a new DFT/REV suffix, admin-approved.';
