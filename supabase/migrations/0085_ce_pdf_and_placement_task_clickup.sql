-- Stage 4/5 of the brief flow: cost-estimate PDF + team scheduling.
-- change_estimates.pdf_url: signed URL of the rendered CE PDF (render-ce-pdf).
-- placement_tasks.clickup_task_*: stamped when schedule-brief-tasks pushes the
-- team-task breakdown to ClickUp; doubles as the idempotency guard.
ALTER TABLE change_estimates
  ADD COLUMN IF NOT EXISTS pdf_url text;
ALTER TABLE placement_tasks
  ADD COLUMN IF NOT EXISTS clickup_task_id text,
  ADD COLUMN IF NOT EXISTS clickup_task_url text;
