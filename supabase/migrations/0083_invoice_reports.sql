-- 0083_invoice_reports.sql
--
-- Reports page (per-client invoice runs on a 20th→20th cycle):
--   1. invoiced_at/invoiced_by marks on briefs (adhoc quick tasks) and
--      projects — marked items drop out of future report runs.
--   2. project_task_rollup view — latest project_actuals snapshot per
--      (project, ClickUp task) plus the first time the task was seen
--      closed, so the report can list "completed in period" tasks
--      without re-scanning 200k snapshot rows client-side.

alter table public.briefs
  add column if not exists invoiced_at timestamptz,
  add column if not exists invoiced_by uuid references public.team_members(id);

comment on column public.briefs.invoiced_at is
  'Set when this adhoc brief''s work was pulled onto a client invoice via the Reports page. Invoiced briefs are excluded from future report runs.';

alter table public.projects
  add column if not exists invoiced_at timestamptz,
  add column if not exists invoiced_by uuid references public.team_members(id);

comment on column public.projects.invoiced_at is
  'Set when this project was invoiced via the Reports page. Invoiced projects are excluded from future report runs.';

-- Supports the distinct-on/first-closed scans in project_task_rollup.
create index if not exists idx_project_actuals_task_recorded
  on public.project_actuals (project_id, clickup_task_id, recorded_at desc);

create or replace view public.project_task_rollup as
with latest as (
  select distinct on (project_id, clickup_task_id)
    project_id,
    clickup_task_id,
    task_name,
    actual_hours,
    cost_cents,
    status_at_sync,
    recorded_at as last_seen_at
  from public.project_actuals
  where clickup_task_id is not null
  order by project_id, clickup_task_id, recorded_at desc
),
first_closed as (
  select project_id, clickup_task_id, min(recorded_at) as closed_at
  from public.project_actuals
  where lower(coalesce(status_at_sync, '')) in ('closed', 'complete', 'done')
  group by project_id, clickup_task_id
)
select
  l.project_id,
  l.clickup_task_id,
  l.task_name,
  l.actual_hours,
  l.cost_cents,
  l.status_at_sync,
  l.last_seen_at,
  fc.closed_at
from latest l
left join first_closed fc
  on fc.project_id = l.project_id
 and fc.clickup_task_id = l.clickup_task_id;

comment on view public.project_task_rollup is
  'Latest snapshot per (project, ClickUp task) from project_actuals, plus the first sync at which the task was seen closed. Powers the Reports page project sections.';
