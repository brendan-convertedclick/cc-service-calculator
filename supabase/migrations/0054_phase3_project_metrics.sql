-- Phase 3: project overview metrics.
-- Adds workspace point rate (used to compute max points = project value /
-- point rate) and the productized flag on services + per-task override.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS standard_point_rate_cents int;

COMMENT ON COLUMN settings.standard_point_rate_cents IS
  'Phase 3: standard point rate in cents. 1 sprint point = 15 min. ' ||
  'Used to compute max_points = project_value_cents / standard_point_rate_cents.';

-- Productized flag on the catalog — most seeded services are productized.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS is_productized boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN services.is_productized IS
  'Phase 3: true = well-known low-variance service. Free-text/bespoke tasks override to false.';

-- Per-task override (lives on project_actuals; tasks themselves live in ClickUp).
ALTER TABLE project_actuals
  ADD COLUMN IF NOT EXISTS is_productized boolean;

COMMENT ON COLUMN project_actuals.is_productized IS
  'Phase 3: NULL = inherit from service; non-null overrides per task.';
