-- CC Service Calculator — initial schema
-- Apply via mcp__cc-supabase__apply_migration (name: init)

-- ============================================================
-- Tables
-- ============================================================

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  hourly_rate_cents integer not null default 0,
  cost_rate_cents integer,
  color text,
  display_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rule_allocations (
  rule_id uuid not null references public.rules(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  pct numeric(5,2) not null check (pct >= 0 and pct <= 100),
  primary key (rule_id, department_id)
);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text unique,
  primary_department_id uuid references public.departments(id) on delete set null,
  cost_rate_cents integer,
  skills text[] not null default '{}',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_member_departments (
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  primary key (team_member_id, department_id)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  sell_price_cents integer not null default 0,
  pricing_model text not null check (pricing_model in ('hourly','fixed','percentage')),
  unit_of_sale text,
  percentage_value numeric(5,2),
  rule_id uuid references public.rules(id) on delete set null,
  primary_team_member_id uuid references public.team_members(id) on delete set null,
  scope_definition text,
  included_revisions text,
  trigger_to_start text,
  completion_definition text,
  owner_role text,
  status text not null default 'active' check (status in ('active','draft','archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index services_rule_id_idx on public.services(rule_id);
create index services_status_idx on public.services(status);

create table public.service_allocation_overrides (
  service_id uuid not null references public.services(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  pct numeric(5,2) not null check (pct >= 0 and pct <= 100),
  primary key (service_id, department_id)
);

create table public.process_steps (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  ordinal integer not null,
  title text not null,
  description text,
  department_id uuid references public.departments(id) on delete set null,
  estimated_hours numeric(6,2),
  ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, ordinal)
);

-- ============================================================
-- Triggers
-- ============================================================

create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_departments_touch before update on public.departments
  for each row execute function public.tg_touch_updated_at();
create trigger trg_rules_touch before update on public.rules
  for each row execute function public.tg_touch_updated_at();
create trigger trg_services_touch before update on public.services
  for each row execute function public.tg_touch_updated_at();
create trigger trg_team_touch before update on public.team_members
  for each row execute function public.tg_touch_updated_at();
create trigger trg_steps_touch before update on public.process_steps
  for each row execute function public.tg_touch_updated_at();

-- Sum-to-100 (±0.5) guard for rule_allocations
create or replace function public.tg_rule_alloc_sum_guard()
returns trigger language plpgsql as $$
declare
  target_rule uuid := coalesce(new.rule_id, old.rule_id);
  total numeric;
begin
  select coalesce(sum(pct),0) into total
    from public.rule_allocations where rule_id = target_rule;
  if (select count(*) from public.rule_allocations where rule_id = target_rule) > 0 then
    if total < 99.5 or total > 100.5 then
      raise exception 'rule_allocations for rule % must sum to 100 (±0.5); got %', target_rule, total;
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger trg_rule_alloc_sum
  after insert or update or delete on public.rule_allocations
  deferrable initially deferred
  for each row execute function public.tg_rule_alloc_sum_guard();

-- Same guard for service_allocation_overrides
create or replace function public.tg_service_override_sum_guard()
returns trigger language plpgsql as $$
declare
  target_service uuid := coalesce(new.service_id, old.service_id);
  total numeric;
begin
  select coalesce(sum(pct),0) into total
    from public.service_allocation_overrides where service_id = target_service;
  if (select count(*) from public.service_allocation_overrides where service_id = target_service) > 0 then
    if total < 99.5 or total > 100.5 then
      raise exception 'service_allocation_overrides for service % must sum to 100 (±0.5); got %', target_service, total;
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger trg_service_override_sum
  after insert or update or delete on public.service_allocation_overrides
  deferrable initially deferred
  for each row execute function public.tg_service_override_sum_guard();

-- ============================================================
-- Views
-- ============================================================

create or replace view public.service_allocation_resolved as
with effective as (
  select
    s.id as service_id,
    s.sell_price_cents,
    coalesce(
      (select jsonb_agg(jsonb_build_object('department_id', sao.department_id, 'pct', sao.pct))
         from public.service_allocation_overrides sao where sao.service_id = s.id),
      (select jsonb_agg(jsonb_build_object('department_id', ra.department_id, 'pct', ra.pct))
         from public.rule_allocations ra where ra.rule_id = s.rule_id)
    ) as rows
  from public.services s
)
select
  e.service_id,
  (row_elem->>'department_id')::uuid as department_id,
  (row_elem->>'pct')::numeric as pct,
  round(e.sell_price_cents * ((row_elem->>'pct')::numeric) / 100.0)::int as price_share_cents,
  case
    when d.hourly_rate_cents > 0 then
      round(
        (e.sell_price_cents * ((row_elem->>'pct')::numeric) / 100.0) / d.hourly_rate_cents,
        2
      )
    else 0
  end as hours
from effective e,
  jsonb_array_elements(coalesce(e.rows, '[]'::jsonb)) row_elem
  join public.departments d on d.id = (row_elem->>'department_id')::uuid;

create or replace view public.service_totals as
select
  s.id as service_id,
  coalesce(sum(sar.hours), 0) as total_hours,
  coalesce(sum(sar.price_share_cents), 0) as total_price_cents
from public.services s
  left join public.service_allocation_resolved sar on sar.service_id = s.id
group by s.id;

-- ============================================================
-- RLS — single shared login, authenticated reads/writes
-- ============================================================

alter table public.departments enable row level security;
alter table public.rules enable row level security;
alter table public.rule_allocations enable row level security;
alter table public.services enable row level security;
alter table public.service_allocation_overrides enable row level security;
alter table public.team_members enable row level security;
alter table public.team_member_departments enable row level security;
alter table public.process_steps enable row level security;

do $$
declare tname text;
begin
  for tname in
    select unnest(array[
      'departments','rules','rule_allocations','services',
      'service_allocation_overrides','team_members',
      'team_member_departments','process_steps'
    ])
  loop
    execute format(
      'create policy %I_authed_all on public.%I for all to authenticated using (true) with check (true)',
      tname, tname
    );
  end loop;
end $$;
