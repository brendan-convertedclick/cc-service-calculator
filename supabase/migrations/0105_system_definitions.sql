-- 0105_system_definitions.sql
-- Apply via mcp__cc-supabase__apply_migration (name: system_definitions)
--
-- Systems untether from services (Phase 4). system_definitions is the new
-- top-level object: a named, owned, goal-bearing way of doing something.
-- process_steps.service_id becomes optional — a step can belong to a system
-- directly (system_id) instead of only via a service.

create table system_definitions (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  kind                 system_kind not null,
  goal_statement       text not null,          -- mandatory: no system without a goal
  goal_metric          text,
  owner_id             uuid references team_members(id),
  expert_id            uuid references team_members(id),
  service_id           uuid references services(id),                        -- kind='service'
  recurring_service_id uuid references retainer_recurring_services(id),      -- kind='recurring'
  time_category_id     uuid references time_categories(id),                 -- kind='internal'
  band                 text,   -- attract | convert | deliver | retain | internal
  trigger_text         text,
  definition_of_done   text,
  exceptions_md        text,
  review_due_at        date,
  current_revision_id  uuid,   -- fk to system_revisions arrives in Phase 5
  archived_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint system_def_kind_link check (
    (kind = 'service'   and service_id is not null)           or
    (kind = 'recurring' and recurring_service_id is not null) or
    (kind = 'internal'  and time_category_id is not null)     or
    (kind = 'reference')
  )
);

create trigger trg_system_definitions_touch before update on public.system_definitions
  for each row execute function public.tg_touch_updated_at();

-- process_steps: a step can now live under a system directly; service_id is
-- no longer the only way in. Per-step goal/definition-of-done/owner mirror
-- the system-level columns so a step can override its system's defaults.
alter table process_steps
  alter column service_id drop not null,
  add column system_id uuid references system_definitions(id) on delete cascade,
  add column goal_statement text,
  add column definition_of_done text,
  add column owner_id uuid references team_members(id);

create index process_steps_system_idx on process_steps(system_id);

-- Backfill: every distinct service_id already in process_steps gets a
-- kind='service' system (placeholder goal — surfaced later as "unmapped"),
-- and its steps get stamped with system_id. Idempotent: guarded by
-- not-exists / system_id is null so a re-run is a no-op.
insert into system_definitions (name, kind, service_id, goal_statement)
select s.name, 'service', s.id, 'TODO: set a goal for this system'
from services s
where exists (select 1 from process_steps ps where ps.service_id = s.id)
  and not exists (
    select 1 from system_definitions sd
    where sd.kind = 'service' and sd.service_id = s.id
  );

update process_steps ps
set system_id = sd.id
from system_definitions sd
where sd.kind = 'service'
  and sd.service_id = ps.service_id
  and ps.system_id is null;

-- RLS: authenticated read for all, write gated on admin/owner. This is the
-- newer two-policy pattern (0058_phase8_full_planning + 0060) — not
-- process_steps' own wide-open authed_all policy, which stays as-is.
alter table system_definitions enable row level security;

create policy system_definitions_authed_read on system_definitions
  for select to authenticated using (true);

create policy system_definitions_admin_all on system_definitions
  for all using (current_team_member_role() in ('admin','owner'))
            with check (current_team_member_role() in ('admin','owner'));
