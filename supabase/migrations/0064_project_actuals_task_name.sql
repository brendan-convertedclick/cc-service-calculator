-- 0064_project_actuals_task_name.sql
-- Apply via mcp__cc-supabase__apply_migration (name: project_actuals_task_name)
--
-- Capture the ClickUp task NAME alongside the task id on project actuals, so
-- the project Tasks table can show "Homepage redesign" instead of "869drq6yu".
-- sync-clickup-actuals already fetches each task object (for its status); it now
-- also writes task.name into this column. Existing rows stay NULL until their
-- next sync (project_actuals is append-only), and the UI falls back to the id.
--
-- Idempotent: add-nullable column + view recreate.

alter table public.project_actuals
  add column if not exists task_name text;

-- Add task_name to the "current" view. Use CREATE OR REPLACE (not DROP) because
-- v_sprint_actuals depends on this view — a DROP would cascade it away. The
-- existing view uses an explicit column list (not select *), so we replicate
-- that exact list and append task_name at the end; CREATE OR REPLACE VIEW
-- permits adding trailing columns while leaving existing columns (and the
-- dependent view) untouched.
create or replace view public.project_actuals_current as
  select distinct on (project_id, clickup_task_id)
    id,
    project_id,
    clickup_task_id,
    dept_id,
    planned_hours,
    actual_hours,
    cost_cents,
    time_entries,
    status_at_sync,
    synced_at,
    recorded_at,
    task_name
  from public.project_actuals
  order by project_id, clickup_task_id, recorded_at desc;
