-- Who declined an extension, not just why.
--
-- `approver_id`/`approved_at` have always recorded an approval; a reject wrote
-- only `rejected_reason`, so the decision had no name against it. The owner now
-- decides on either leg (see extension-logic.ts), which makes "who said no"
-- the same question as "who said yes".
--
-- Nullable: the shared team@ login resolves to owner without a team_members
-- row, so currentUserId is null there.

ALTER TABLE extension_requests
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES team_members(id),
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

COMMENT ON COLUMN extension_requests.rejected_by IS
  'Who rejected the request. Null for rows rejected before this column existed, '
  'or by the shared team@ login.';
