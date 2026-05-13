-- supabase/migrations/0042_brief_suggested_services.sql
-- Pre-populated service suggestions emitted by the intake skill (Stage 2).
-- Shape: [{ service_id: uuid, qty: number, confidence: number, reasoning: string }]
-- The quote builder reads this on mount and auto-fills lines when present, so
-- AMs do not need to click "Suggest services from scope" for intake-processed briefs.
alter table brief_intelligence
  add column if not exists suggested_services jsonb;
