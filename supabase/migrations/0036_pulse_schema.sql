-- Retainer fields on projects
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS retainer_hours_target     numeric(6,2),
  ADD COLUMN IF NOT EXISTS retainer_monthly_fee_cents int;

-- Manual client touchpoints
CREATE TABLE IF NOT EXISTS client_touchpoints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('meeting', 'call', 'email')),
  notes        text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_touchpoints_client_id
  ON client_touchpoints(client_id);
CREATE INDEX IF NOT EXISTS idx_client_touchpoints_occurred_at
  ON client_touchpoints(occurred_at DESC);

ALTER TABLE client_touchpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_authenticated" ON client_touchpoints
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
