-- Phase 7 (and Phase 4 future): Change Estimates.
-- Same table covers (a) intake outside-scope CEs from Phase 4 and
-- (b) mid-project Adjust-Plan CEs from Phase 7. `source` distinguishes.

CREATE TABLE IF NOT EXISTS change_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  brief_id uuid REFERENCES briefs(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  source text NOT NULL CHECK (source IN ('intake_outside_scope','mid_project_adjust')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','approved','rejected','cancelled')),
  reason text,
  summary text,
  delta_value_cents int NOT NULL DEFAULT 0,
  delta_points numeric(8,2) NOT NULL DEFAULT 0,
  outbound_email_id uuid REFERENCES outbound_emails(id),
  external_approval_id text,
  approved_at timestamptz,
  approver_email text,
  approval_note text,
  rejected_at timestamptz,
  rejected_reason text,
  created_by uuid NOT NULL REFERENCES team_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS change_estimates_project_idx ON change_estimates(project_id);
CREATE INDEX IF NOT EXISTS change_estimates_status_idx ON change_estimates(status);

CREATE TABLE IF NOT EXISTS change_estimate_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_estimate_id uuid NOT NULL REFERENCES change_estimates(id) ON DELETE CASCADE,
  service_id uuid REFERENCES services(id),
  description text NOT NULL,
  qty numeric(8,2) NOT NULL DEFAULT 1,
  unit_points numeric(8,2) NOT NULL,
  unit_value_cents int NOT NULL,
  line_kind text NOT NULL CHECK (line_kind IN ('add','cancel','reduce')),
  target_task_id text,
  sort_order int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ce_line_items_ce_idx ON change_estimate_line_items(change_estimate_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION change_estimates_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS change_estimates_updated_at ON change_estimates;
CREATE TRIGGER change_estimates_updated_at
  BEFORE UPDATE ON change_estimates
  FOR EACH ROW EXECUTE FUNCTION change_estimates_set_updated_at();

-- RLS — admin/owner read/write
ALTER TABLE change_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_estimate_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS change_estimates_admin_all ON change_estimates;
CREATE POLICY change_estimates_admin_all ON change_estimates
  FOR ALL USING (current_team_member_role() IN ('admin','owner'))
            WITH CHECK (current_team_member_role() IN ('admin','owner'));

DROP POLICY IF EXISTS ce_line_items_admin_all ON change_estimate_line_items;
CREATE POLICY ce_line_items_admin_all ON change_estimate_line_items
  FOR ALL USING (current_team_member_role() IN ('admin','owner'))
            WITH CHECK (current_team_member_role() IN ('admin','owner'));

COMMENT ON TABLE change_estimates IS 'Phase 4 + 7: Change Estimates (outside-scope at intake OR mid-project adjust).';
