-- Phase 2 follow-up: due-date extensions alongside sprint-point extensions.
-- A request can now ask for extra points, a new due date, or both — each
-- with its own reason. Tiering combines both dimensions (see
-- src/types/extension-requests.ts classifyDueDateTier + maxTier).

ALTER TABLE extension_requests
  ALTER COLUMN original_points DROP NOT NULL,
  ALTER COLUMN extra_points DROP NOT NULL,
  ALTER COLUMN delta_pct DROP NOT NULL,
  ALTER COLUMN reason DROP NOT NULL;

ALTER TABLE extension_requests
  ADD COLUMN IF NOT EXISTS original_due_date date,
  ADD COLUMN IF NOT EXISTS requested_due_date date,
  ADD COLUMN IF NOT EXISTS due_date_reason text;

ALTER TABLE extension_requests
  DROP CONSTRAINT IF EXISTS extension_requests_has_request,
  ADD CONSTRAINT extension_requests_has_request CHECK (
    extra_points IS NOT NULL OR requested_due_date IS NOT NULL
  );

ALTER TABLE extension_requests
  DROP CONSTRAINT IF EXISTS extension_requests_points_reason,
  ADD CONSTRAINT extension_requests_points_reason CHECK (
    extra_points IS NULL OR reason IS NOT NULL
  );

ALTER TABLE extension_requests
  DROP CONSTRAINT IF EXISTS extension_requests_due_date_reason,
  ADD CONSTRAINT extension_requests_due_date_reason CHECK (
    requested_due_date IS NULL OR due_date_reason IS NOT NULL
  );

COMMENT ON COLUMN extension_requests.requested_due_date IS
  'New due date being requested. NULL if this request is points-only.';
COMMENT ON COLUMN extension_requests.due_date_reason IS
  'Reason for the due-date push. Required whenever requested_due_date is set.';
