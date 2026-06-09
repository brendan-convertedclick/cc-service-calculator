-- Phase 8: full planning workflow.
-- Per-person tracking mode (live vs manual), retainer recurring services,
-- materialised provisioning records, sprint-points view over actuals.

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS tracking_mode text NOT NULL DEFAULT 'live'
    CHECK (tracking_mode IN ('live','manual'));

COMMENT ON COLUMN team_members.tracking_mode IS
  'Phase 8: live = perpetual ClickUp task + Rize.io time syncs; manual = discrete dated ClickUp tasks seeded per period.';

-- Recurring services attached to a retainer (which is a project with is_recurring=true).
CREATE TABLE IF NOT EXISTS retainer_recurring_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id),
  cadence text NOT NULL CHECK (cadence IN ('daily','weekly','biweekly','monthly','custom')),
  occurrences_per_month numeric(5,2) NOT NULL CHECK (occurrences_per_month > 0),
  points_per_occurrence numeric(5,2) NOT NULL CHECK (points_per_occurrence > 0),
  default_assignees uuid[] NOT NULL DEFAULT '{}',
  is_live_eligible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retainer_recurring_services_project_idx
  ON retainer_recurring_services(project_id);

-- Materialised record of what was provisioned per (assignee × service × period).
CREATE TABLE IF NOT EXISTS provisioned_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recurring_service_id uuid NOT NULL REFERENCES retainer_recurring_services(id) ON DELETE CASCADE,
  assignee_id uuid NOT NULL REFERENCES team_members(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  mode text NOT NULL CHECK (mode IN ('live','manual')),
  clickup_task_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provisioned_tasks_period_idx
  ON provisioned_tasks(recurring_service_id, assignee_id, period_start);

-- Sprint-points view: read time entries in minutes from project_actuals_current
-- and surface a single sprint-points column. 1pt = 15min.
CREATE OR REPLACE VIEW v_sprint_actuals AS
SELECT
  pa.project_id,
  pa.id AS actual_id,
  pa.clickup_task_id,
  ROUND((pa.actual_hours * 60.0) / 15.0, 2) AS sprint_points,
  pa.recorded_at,
  pa.synced_at
FROM project_actuals_current pa
WHERE pa.actual_hours IS NOT NULL;

COMMENT ON VIEW v_sprint_actuals IS
  'Phase 8: canonical sprint-points view over project_actuals_current. 1 sprint point = 15 minutes. All Productivity/Pulse/Projects consumers should read points from here rather than computing from hours inline.';

-- RLS
ALTER TABLE retainer_recurring_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioned_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rrs_admin_all ON retainer_recurring_services;
CREATE POLICY rrs_admin_all ON retainer_recurring_services
  FOR ALL USING (current_team_member_role() IN ('admin','owner'))
            WITH CHECK (current_team_member_role() IN ('admin','owner'));

DROP POLICY IF EXISTS provisioned_tasks_admin_all ON provisioned_tasks;
CREATE POLICY provisioned_tasks_admin_all ON provisioned_tasks
  FOR ALL USING (current_team_member_role() IN ('admin','owner'))
            WITH CHECK (current_team_member_role() IN ('admin','owner'));
