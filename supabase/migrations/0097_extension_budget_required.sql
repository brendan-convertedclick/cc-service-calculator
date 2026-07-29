-- Every extension request now states a budget, even when that budget is zero.
-- A due-date push with extra_points = 0 says "this needs more time but costs
-- nothing"; NULL says nobody answered. The approval surfaces treat those
-- differently, so the DB has to allow the explicit zero.

ALTER TABLE extension_requests
  DROP CONSTRAINT IF EXISTS extension_requests_extra_points_check,
  ADD CONSTRAINT extension_requests_extra_points_check CHECK (extra_points >= 0);

-- A zero budget has nothing to justify — the due-date reason carries the ask.
ALTER TABLE extension_requests
  DROP CONSTRAINT IF EXISTS extension_requests_points_reason,
  ADD CONSTRAINT extension_requests_points_reason CHECK (
    extra_points IS NULL OR extra_points = 0 OR reason IS NOT NULL
  );

-- With 0 permitted, "extra_points IS NOT NULL" no longer proves anything was
-- asked for. A row must still request points or a date.
ALTER TABLE extension_requests
  DROP CONSTRAINT IF EXISTS extension_requests_has_request,
  ADD CONSTRAINT extension_requests_has_request CHECK (
    extra_points > 0 OR requested_due_date IS NOT NULL
  );

COMMENT ON COLUMN extension_requests.extra_points IS
  'Sprint points requested on top of the original budget. Required on new rows '
  '(the staff form enforces it); 0 means "no extra budget needed". NULL only on '
  'rows created before the budget field became mandatory.';
