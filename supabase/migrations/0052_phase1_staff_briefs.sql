-- Phase 1: staff-authored briefs
-- Adds role + auth_user_id to team_members; introduces staff_briefs table with RLS.

-- 1) Role enum on team_members
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'staff'
    CHECK (role IN ('staff','admin','owner'));

-- 2) auth.users linkage
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS team_members_auth_user_id_key
  ON team_members(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- 3) staff_briefs table
CREATE TABLE IF NOT EXISTS staff_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitter_id uuid NOT NULL REFERENCES team_members(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  clickup_list_id text NOT NULL,
  clickup_list_name text NOT NULL,
  task_name text NOT NULL,
  sprint_points numeric(5,2) NOT NULL CHECK (sprint_points > 0),
  is_internal boolean NOT NULL DEFAULT false,
  goal text NOT NULL,
  success_criteria text NOT NULL,
  measurable_outcome text NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','approved','rejected')),
  auto_approved boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES team_members(id),
  approved_at timestamptz,
  rejected_reason text,
  clickup_task_id text,
  clickup_task_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_briefs_status_idx ON staff_briefs(status);
CREATE INDEX IF NOT EXISTS staff_briefs_submitter_idx ON staff_briefs(submitter_id);
CREATE INDEX IF NOT EXISTS staff_briefs_client_idx ON staff_briefs(client_id);

-- 4) updated_at trigger
CREATE OR REPLACE FUNCTION staff_briefs_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS staff_briefs_updated_at ON staff_briefs;
CREATE TRIGGER staff_briefs_updated_at
  BEFORE UPDATE ON staff_briefs
  FOR EACH ROW EXECUTE FUNCTION staff_briefs_set_updated_at();

-- 5) Role/identity helpers (SECURITY DEFINER so RLS can call them)
CREATE OR REPLACE FUNCTION current_team_member_id() RETURNS uuid AS $$
  SELECT id FROM team_members
   WHERE auth_user_id = auth.uid()
      OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
   LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_team_member_role() RETURNS text AS $$
  SELECT role FROM team_members
   WHERE auth_user_id = auth.uid()
      OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
   LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 6) RLS
ALTER TABLE staff_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_briefs_select_own ON staff_briefs;
CREATE POLICY staff_briefs_select_own ON staff_briefs
  FOR SELECT USING (
    submitter_id = current_team_member_id()
    OR current_team_member_role() IN ('admin','owner')
  );

DROP POLICY IF EXISTS staff_briefs_insert_own ON staff_briefs;
CREATE POLICY staff_briefs_insert_own ON staff_briefs
  FOR INSERT WITH CHECK (
    submitter_id = current_team_member_id()
  );

DROP POLICY IF EXISTS staff_briefs_update_admin ON staff_briefs;
CREATE POLICY staff_briefs_update_admin ON staff_briefs
  FOR UPDATE USING (
    current_team_member_role() IN ('admin','owner')
  );

-- 7) Seed roles: Brendan = owner. Everyone else stays default staff.
UPDATE team_members SET role = 'owner' WHERE email = 'brendan@convertedclick.co.za';

COMMENT ON COLUMN team_members.role IS 'Phase 1: access tier — staff (form only) | admin (approvals queue + full app) | owner (escalations + everything)';
COMMENT ON TABLE staff_briefs IS 'Phase 1: staff-authored briefs awaiting approval before ClickUp push.';
