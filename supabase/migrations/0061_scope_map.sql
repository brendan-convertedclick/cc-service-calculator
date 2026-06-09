-- Scope Map: rebuild of the Phase 4 SoW check.
-- (a) client_sows links each client to the master SoW engagements they hold,
-- (b) brief_task_sow_placements becomes self-contained (item text lives on the
--     row instead of the dead scopes.line_items inlet),
-- (c) current_team_member_role() gains the shared-login fallback so RLS writes
--     work under team@convertedclick.co.za,
-- (d) change_estimates relaxed so intake CEs can exist without a project or an
--     attributable creator.

-- 1) Which master SoW engagements does each client hold?
CREATE TABLE IF NOT EXISTS client_sows (
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sow_slug text NOT NULL REFERENCES master_sows(slug) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, sow_slug)
);

ALTER TABLE client_sows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_sows_admin_all ON client_sows;
CREATE POLICY client_sows_admin_all ON client_sows
  FOR ALL USING (current_team_member_role() IN ('admin','owner'))
            WITH CHECK (current_team_member_role() IN ('admin','owner'));

COMMENT ON TABLE client_sows IS
  'Scope Map: which master SoW engagements a client holds. Confirmed once at first analysis, then reused.';
COMMENT ON COLUMN client_sows.status IS 'active = considered during scope analysis; ended = historical, ignored.';

-- 2) Self-contained placement rows: the extracted ask lives on the row itself.
ALTER TABLE brief_task_sow_placements ADD COLUMN IF NOT EXISTS item_name text;
ALTER TABLE brief_task_sow_placements ADD COLUMN IF NOT EXISTS item_description text;
ALTER TABLE brief_task_sow_placements ADD COLUMN IF NOT EXISTS sow_slug text REFERENCES master_sows(slug);
ALTER TABLE brief_task_sow_placements ADD COLUMN IF NOT EXISTS suggested_service_id uuid REFERENCES services(id);
ALTER TABLE brief_task_sow_placements ADD COLUMN IF NOT EXISTS estimated_cents int;

COMMENT ON COLUMN brief_task_sow_placements.item_name IS 'Scope Map: short label of the extracted client ask (<=60 chars).';
COMMENT ON COLUMN brief_task_sow_placements.item_description IS 'Scope Map: full description of the extracted ask.';
COMMENT ON COLUMN brief_task_sow_placements.sow_slug IS 'Scope Map: which master SoW covers this item (null when outside all selected SoWs).';
COMMENT ON COLUMN brief_task_sow_placements.suggested_service_id IS 'Scope Map: catalogue service that would deliver an outside-scope item.';
COMMENT ON COLUMN brief_task_sow_placements.estimated_cents IS 'Scope Map: estimated cost in cents (catalogue sell price or AI ballpark).';

-- 3) Shared-login fallback for the role helper.
-- The UI hook useCurrentRole special-cases team@convertedclick.co.za as 'owner'
-- (V1 shared login has no team_members row); mirror that in SQL so RLS agrees.
CREATE OR REPLACE FUNCTION current_team_member_role() RETURNS text AS $$
  SELECT COALESCE(
    (SELECT role FROM team_members
      WHERE auth_user_id = auth.uid()
         OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
      LIMIT 1),
    CASE WHEN (SELECT email FROM auth.users WHERE id = auth.uid())
              = 'team@convertedclick.co.za'
         THEN 'owner' END
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION current_team_member_role() IS
  'Role of the signed-in user; mirrors the useCurrentRole dev special case for the V1 shared login (team@ → owner).';

-- 4) Intake CEs: no project yet, and the shared login has no team_members row.
ALTER TABLE change_estimates ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE change_estimates ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE change_estimates DROP CONSTRAINT IF EXISTS change_estimates_adjust_needs_project;
ALTER TABLE change_estimates ADD CONSTRAINT change_estimates_adjust_needs_project
  CHECK (source <> 'mid_project_adjust' OR project_id IS NOT NULL);

COMMENT ON COLUMN change_estimates.project_id IS
  'Nullable since Scope Map: intake_outside_scope CEs may predate any project; mid_project_adjust still requires one (check constraint).';
COMMENT ON COLUMN change_estimates.created_by IS
  'Nullable since Scope Map: V1 shared login has no team_members row, so attribution may be unknown.';
