-- Phase 5: per-project problem detection + chronological event log.

CREATE TABLE IF NOT EXISTS project_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  clickup_task_id text,
  actor_team_member_id uuid REFERENCES team_members(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_events_project_occurred_idx
  ON project_events(project_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS project_events_dedupe_idx
  ON project_events(project_id, event_type, COALESCE(clickup_task_id,''), occurred_at);

CREATE TABLE IF NOT EXISTS project_problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  problem_type text NOT NULL
    CHECK (problem_type IN ('budget_overrun','underquoting','extension_pressure','late_internal','late_external')),
  severity text NOT NULL CHECK (severity IN ('low','med','high')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid REFERENCES team_members(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS project_problems_active_idx
  ON project_problems(project_id, problem_type) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS project_problems_unresolved_idx
  ON project_problems(severity) WHERE resolved_at IS NULL;

-- RLS — admin+owner read/write; nobody else.
ALTER TABLE project_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_problems ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_events_select ON project_events;
CREATE POLICY project_events_select ON project_events
  FOR SELECT USING (current_team_member_role() IN ('admin','owner'));

DROP POLICY IF EXISTS project_problems_select ON project_problems;
CREATE POLICY project_problems_select ON project_problems
  FOR SELECT USING (current_team_member_role() IN ('admin','owner'));

DROP POLICY IF EXISTS project_problems_update ON project_problems;
CREATE POLICY project_problems_update ON project_problems
  FOR UPDATE USING (current_team_member_role() IN ('admin','owner'));

-- Configurable "waiting on client" status names.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS waiting_on_client_statuses text[] NOT NULL DEFAULT ARRAY['waiting on client', 'waiting for client', 'on hold - client'];

COMMENT ON TABLE project_events IS 'Phase 5: chronological per-project audit log, sourced from ClickUp + app events.';
COMMENT ON TABLE project_problems IS 'Phase 5: detector-flagged issues per project (budget/under/extensions/late).';
