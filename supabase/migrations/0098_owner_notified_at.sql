-- Durable dedup marker for the "DM the owner about new pending approvals"
-- poller: set once a pending item has been reported, so re-checking on a
-- schedule never double-notifies regardless of poll interval or restarts.

ALTER TABLE staff_briefs ADD COLUMN IF NOT EXISTS owner_notified_at timestamptz;
ALTER TABLE extension_requests ADD COLUMN IF NOT EXISTS owner_notified_at timestamptz;
ALTER TABLE revision_requests ADD COLUMN IF NOT EXISTS owner_notified_at timestamptz;
