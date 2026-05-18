-- Phase 2: extension requests.
-- Staff request extra sprint points on an existing ClickUp task. Tiered
-- approval (auto <25%, admin 25-50%, owner >50%). On approval a linked
-- subtask is created in ClickUp.

CREATE TABLE IF NOT EXISTS extension_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES team_members(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  parent_clickup_task_id text NOT NULL,
  parent_task_name text NOT NULL,
  original_points numeric(8,2) NOT NULL CHECK (original_points > 0),
  extra_points numeric(8,2) NOT NULL CHECK (extra_points > 0),
  delta_pct numeric(7,2) NOT NULL,
  tier text NOT NULL CHECK (tier IN ('auto','admin','owner')),
  reason text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('auto_approved','pending_admin','pending_owner','approved','rejected')),
  approver_id uuid REFERENCES team_members(id),
  approved_at timestamptz,
  rejected_reason text,
  clickup_subtask_id text,
  clickup_subtask_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extension_requests_status_idx ON extension_requests(status);
CREATE INDEX IF NOT EXISTS extension_requests_requester_idx ON extension_requests(requester_id);
CREATE INDEX IF NOT EXISTS extension_requests_parent_task_idx
  ON extension_requests(parent_clickup_task_id);
CREATE INDEX IF NOT EXISTS extension_requests_tier_idx ON extension_requests(tier);

-- updated_at trigger
CREATE OR REPLACE FUNCTION extension_requests_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS extension_requests_updated_at ON extension_requests;
CREATE TRIGGER extension_requests_updated_at
  BEFORE UPDATE ON extension_requests
  FOR EACH ROW EXECUTE FUNCTION extension_requests_set_updated_at();

-- RLS
ALTER TABLE extension_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS extension_requests_select ON extension_requests;
CREATE POLICY extension_requests_select ON extension_requests
  FOR SELECT USING (
    requester_id = current_team_member_id()
    OR current_team_member_role() IN ('admin','owner')
  );

DROP POLICY IF EXISTS extension_requests_insert_own ON extension_requests;
CREATE POLICY extension_requests_insert_own ON extension_requests
  FOR INSERT WITH CHECK (
    requester_id = current_team_member_id()
  );

-- Admin can update auto + admin tier rows. Owner can update everything.
DROP POLICY IF EXISTS extension_requests_update_admin ON extension_requests;
CREATE POLICY extension_requests_update_admin ON extension_requests
  FOR UPDATE USING (
    (current_team_member_role() = 'admin' AND tier IN ('auto','admin'))
    OR current_team_member_role() = 'owner'
  );

COMMENT ON TABLE extension_requests IS 'Phase 2: staff extension requests on existing tasks with tiered approval.';
