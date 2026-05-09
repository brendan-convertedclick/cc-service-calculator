-- supabase/migrations/0031_brief_intelligence.sql
create table if not exists brief_intelligence (
  id                      uuid primary key default gen_random_uuid(),
  brief_id                uuid not null unique references briefs(id) on delete cascade,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Stage 2: interpretation
  summary                 text,
  business_objective      text,
  client_context_snap     jsonb,

  -- Stage 2: requirements mapped to services
  -- [{text, interpretation, mapped_service_ids: uuid[], confidence: 'low'|'med'|'high'}]
  requirements            jsonb,

  -- Stage 3: work breakdown per department
  -- [{department_id, department_name, deliverables, tasks,
  --   human_hours_low, human_hours_mid, human_hours_high,
  --   ai_hours, suggested_assignee_id}]
  work_breakdown          jsonb,

  -- Stage 4: rolled-up estimation
  total_human_hours_low   numeric(6,2),
  total_human_hours_mid   numeric(6,2),
  total_human_hours_high  numeric(6,2),
  total_ai_hours          numeric(6,2),
  estimated_price_cents   integer,
  confidence_level        text check (confidence_level in ('low','medium','high')),
  -- [{question: string, context: string}]
  open_questions          jsonb,

  -- Stage 4: capacity signal
  inferred_start_date     date,
  inferred_deadline       date,
  priority_tier           text check (priority_tier in ('urgent','standard','flexible')),

  -- AM approval gate
  am_status               text not null default 'pending'
                          check (am_status in ('pending','approved','rejected')),
  am_reviewed_at          timestamptz,
  am_reviewed_by          uuid references team_members(id),
  am_notes                text,

  -- Generation metadata
  pipeline_version        text,
  services_snapshot       jsonb,
  -- [{stage, completed_at, duration_ms, confidence, notes}]
  audit_trail             jsonb not null default '[]'
);

create index brief_intelligence_brief_id_idx on brief_intelligence(brief_id);
create index brief_intelligence_am_status_idx  on brief_intelligence(am_status);

alter table brief_intelligence enable row level security;
create policy "authenticated full access" on brief_intelligence
  for all to authenticated using (true) with check (true);
