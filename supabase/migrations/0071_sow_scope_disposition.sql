-- Scope Ledger Rail — schema for the deterministic disposition engine.
--
-- (a) services.is_deliverable flags which catalogue lines represent actual
--     agency delivery vs. Software / Spend / Pass-Through / Non-Delivery lines
--     (which can never be "in scope" — they are always out_of_scope).
-- (b) brief_task_sow_placements gains the per-ask scope-receipt fields the new
--     resolveDisposition() rail writes: the disposition bucket, the LLM's
--     extracted quantity + verbatim grounding quote, and a review flag.
--
-- Additive only: keeps is_inside (the old binary in/out signal) intact.

-- 1) Catalogue delivery flag.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS is_deliverable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN services.is_deliverable IS
  'Scope Ledger Rail: false for Software / Spend / Pass-Through / Non-Delivery catalogue lines (Genre bucket). Non-deliverable services can never be in_agreed_scope — resolveDisposition() forces them out_of_scope.';

-- Non-delivery codes derived from data/service_catalog.csv where Genre is the
-- "Software / Spend / Pass-Through / Non-Delivery" bucket (25 ServiceIDs).
UPDATE services
SET is_deliverable = false
WHERE code IN (
  '041','054','055','076','1000','10111','10112','132','133','134',
  '138','139','20111','3D006','3D007','3D008','3D009','3D010',
  '42','47','50','54','57','58','67'
);

-- 2) Per-ask scope-receipt fields on the placement row.
ALTER TABLE brief_task_sow_placements
  ADD COLUMN IF NOT EXISTS disposition text
    CHECK (disposition IN ('in_agreed_scope','new_billable','out_of_scope'));
ALTER TABLE brief_task_sow_placements
  ADD COLUMN IF NOT EXISTS quantity numeric(8,2) DEFAULT 1;
ALTER TABLE brief_task_sow_placements
  ADD COLUMN IF NOT EXISTS grounding_quote text;
ALTER TABLE brief_task_sow_placements
  ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT false;

COMMENT ON COLUMN brief_task_sow_placements.disposition IS
  'Scope Ledger Rail: deterministic bucket from resolveDisposition() — in_agreed_scope | new_billable | out_of_scope. Nullable for legacy rows; CHECK permits NULL.';
COMMENT ON COLUMN brief_task_sow_placements.quantity IS
  'Scope Ledger Rail: quantity the LLM extracted for this ask (defaults to 1).';
COMMENT ON COLUMN brief_task_sow_placements.grounding_quote IS
  'Scope Ledger Rail: verbatim quote from the inbound message that grounds the extracted ask.';
COMMENT ON COLUMN brief_task_sow_placements.needs_review IS
  'Scope Ledger Rail: true when confidence is low or the quantity is unusable, so an operator should eyeball the disposition.';

-- 3) Backfill disposition from the legacy binary signal.
UPDATE brief_task_sow_placements
SET disposition = CASE WHEN is_inside THEN 'in_agreed_scope' ELSE 'new_billable' END
WHERE disposition IS NULL;
