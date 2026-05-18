-- Phase 4: SoW visualization (bubble UI + AI matcher).

-- Service areas declared per master SoW (e.g. "Social media", "Ads", "Content").
CREATE TABLE IF NOT EXISTS sow_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sow_slug text NOT NULL REFERENCES master_sows(slug) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sow_service_areas_sow_idx ON sow_service_areas(sow_slug);
CREATE UNIQUE INDEX IF NOT EXISTS sow_service_areas_unique
  ON sow_service_areas(sow_slug, lower(name));

-- AI-matched + operator-overridden placement for each proposed task on a brief.
CREATE TABLE IF NOT EXISTS brief_task_sow_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  task_ref text NOT NULL,                   -- identifier of the proposed task (line_item id or AI-task id)
  service_area_id uuid REFERENCES sow_service_areas(id) ON DELETE SET NULL,
  is_inside boolean NOT NULL,
  ai_match_quote text,
  ai_confidence numeric(3,2),
  override_reason text,
  approved_by uuid REFERENCES team_members(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brief_task_sow_placements_brief_idx
  ON brief_task_sow_placements(brief_id);
CREATE UNIQUE INDEX IF NOT EXISTS brief_task_sow_placements_unique
  ON brief_task_sow_placements(brief_id, task_ref);

CREATE OR REPLACE FUNCTION brief_task_sow_placements_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS brief_task_sow_placements_updated_at ON brief_task_sow_placements;
CREATE TRIGGER brief_task_sow_placements_updated_at
  BEFORE UPDATE ON brief_task_sow_placements
  FOR EACH ROW EXECUTE FUNCTION brief_task_sow_placements_updated_at();

-- RLS: admin + owner read/write
ALTER TABLE sow_service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE brief_task_sow_placements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sow_service_areas_admin_all ON sow_service_areas;
CREATE POLICY sow_service_areas_admin_all ON sow_service_areas
  FOR ALL USING (current_team_member_role() IN ('admin','owner'))
            WITH CHECK (current_team_member_role() IN ('admin','owner'));

DROP POLICY IF EXISTS brief_task_sow_placements_admin_all ON brief_task_sow_placements;
CREATE POLICY brief_task_sow_placements_admin_all ON brief_task_sow_placements
  FOR ALL USING (current_team_member_role() IN ('admin','owner'))
            WITH CHECK (current_team_member_role() IN ('admin','owner'));

COMMENT ON TABLE sow_service_areas IS 'Phase 4: per-master-SoW service areas (bubble labels).';
COMMENT ON TABLE brief_task_sow_placements IS
  'Phase 4: per-brief in/out classification of proposed tasks against SoW service areas.';
