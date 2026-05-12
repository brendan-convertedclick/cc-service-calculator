-- supabase/migrations/0038_ai_sessions.sql

-- Agent registry: CC skills with creator + estimated human time per run
create table if not exists agents (
  id                           text primary key,
  name                         text not null,
  description                  text not null,
  creator                      text not null,
  created_at                   date not null,
  estimated_human_hours_per_run numeric(5,2) not null default 0.5
);

-- Seed the 5 existing CC agents
insert into agents (id, name, description, creator, created_at, estimated_human_hours_per_run) values
  ('skill-intake',    '/intake',    'Email triage — scans Gmail, classifies, creates briefs',       'brendan@convertedclick.co.za', '2026-03-01', 0.5),
  ('skill-log',       '/log',       'Retroactive task logging to ClickUp',                          'brendan@convertedclick.co.za', '2026-03-01', 0.25),
  ('skill-brief',     '/brief',     'Issue pre-scoped tasks to team via ClickUp',                   'brendan@convertedclick.co.za', '2026-03-01', 0.5),
  ('skill-scheduler', '/scheduler', 'Task estimation + sprint burn reporting',                      'brendan@convertedclick.co.za', '2026-03-01', 0.5),
  ('skill-sow',       '/sow',       'Scope of work creation + quoting',                            'brendan@convertedclick.co.za', '2026-03-01', 1.0)
on conflict (id) do nothing;

-- AI session log: one row per Claude Code session logged via /log
create table if not exists ai_sessions (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  logged_by           text not null,
  session_date        date not null,
  clickup_task_id     text,
  project_slug        text,
  ai_input_tokens     integer not null default 0,
  ai_output_tokens    integer not null default 0,
  ai_duration_minutes numeric(8,2) not null default 0,
  ai_cost_zar         numeric(10,2) not null default 0,
  human_minutes       numeric(8,2) not null default 0,
  concurrent_sessions integer not null default 1,
  engagement_type     text not null default 'task'
                        check (engagement_type in ('task', 'agent-run')),
  agent_id            text references agents(id)
);

create index if not exists ai_sessions_logged_by_date
  on ai_sessions (logged_by, session_date);
create index if not exists ai_sessions_engagement_type
  on ai_sessions (engagement_type);

-- Settings: blended hourly rate for passive cost equivalents (ZAR)
alter table settings
  add column if not exists blended_hourly_rate_zar integer not null default 350;
