-- supabase/migrations/0032_process_step_instances.sql

create table process_step_instances (
  id                uuid        primary key default gen_random_uuid(),
  project_id        uuid        not null references projects(id) on delete cascade,
  template_step_id  uuid        references process_steps(id) on delete set null,
  service_id        uuid        references services(id) on delete set null,
  ordinal           int         not null,
  title             text        not null,
  description       text,
  department_id     uuid        references departments(id) on delete set null,
  assignee_id       uuid        references team_members(id) on delete set null,
  estimated_hours   numeric(6,2),
  actual_hours      numeric(6,2) not null default 0,
  status            text        not null default 'pending'
                    check (status in ('pending','in_progress','blocked','done','skipped')),
  blocked_reason    text,
  clickup_task_id   text,
  due_at            timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  last_synced_at    timestamptz,
  manual_override   boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index on process_step_instances (project_id, ordinal);
create index on process_step_instances (clickup_task_id) where clickup_task_id is not null;

-- updated_at trigger
create trigger trg_step_instances_touch
  before update on process_step_instances
  for each row execute function public.tg_touch_updated_at();

-- View: handoff time between consecutive steps
create view process_step_handoffs as
select
  a.project_id,
  a.id                                                                              as from_step_id,
  b.id                                                                              as to_step_id,
  a.ordinal                                                                         as from_ordinal,
  a.title                                                                           as from_title,
  b.title                                                                           as to_title,
  a.completed_at                                                                    as from_completed_at,
  b.started_at                                                                      as to_started_at,
  GREATEST(0, extract(epoch from (b.started_at - a.completed_at)) / 3600.0)        as handoff_hours
from   process_step_instances a
join   process_step_instances b
       on  b.project_id = a.project_id
       and b.ordinal    = a.ordinal + 1
where  a.completed_at is not null
and    b.started_at   is not null;

-- RLS
alter table process_step_instances enable row level security;

create policy step_instances_authed_all on process_step_instances
  for all to authenticated using (true) with check (true);
