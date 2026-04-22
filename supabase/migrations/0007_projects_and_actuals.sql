-- 0007_projects_and_actuals.sql
-- Apply via mcp__cc-supabase__apply_migration (name: projects_and_actuals)

create type public.project_status as enum ('in_progress', 'completed', 'cancelled');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) unique,
  clickup_parent_task_id text not null,
  status public.project_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_actuals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  clickup_task_id text not null,
  dept_id uuid references public.departments(id),
  planned_hours numeric(8,2) not null,
  actual_hours numeric(8,2) not null default 0,
  time_entries jsonb,
  status_at_sync text,
  synced_at timestamptz not null default now()
);
create unique index project_actuals_project_task_idx
  on public.project_actuals (project_id, clickup_task_id);
