-- CC Service Calculator — compound services
-- Apply via mcp__cc-supabase__apply_migration (name: compound_services)

-- ============================================================
-- 1. service_children table
-- ============================================================

create table if not exists public.service_children (
  parent_id    uuid not null references public.services(id) on delete cascade,
  child_id     uuid not null references public.services(id) on delete restrict,
  ordinal      int  not null,
  quantity     int  not null default 1 check (quantity >= 1),
  created_at   timestamptz not null default now(),
  primary key (parent_id, ordinal),
  unique (parent_id, child_id),
  check (parent_id <> child_id)
);

create index if not exists idx_service_children_child on public.service_children(child_id);

-- ============================================================
-- 2. RLS — single authenticated policy, matching every other table
-- ============================================================

alter table public.service_children enable row level security;

drop policy if exists "service_children authenticated all" on public.service_children;
create policy "service_children authenticated all"
  on public.service_children
  for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- 3. Cycle-prevention trigger
-- ============================================================

create or replace function public.tg_service_children_no_cycle()
returns trigger
language plpgsql
as $$
declare
  cycle_found boolean;
begin
  with recursive ancestors as (
    select NEW.parent_id as node_id, 0 as depth
    union all
    select sc.parent_id, a.depth + 1
    from public.service_children sc
    join ancestors a on sc.child_id = a.node_id
    where a.depth < 20
  )
  select exists (select 1 from ancestors where node_id = NEW.child_id)
    into cycle_found;

  if cycle_found then
    raise exception 'Adding this child would create a cycle in the service tree';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_service_children_no_cycle on public.service_children;
create trigger trg_service_children_no_cycle
  before insert or update on public.service_children
  for each row execute function public.tg_service_children_no_cycle();

-- ============================================================
-- 4. Rewrite service_allocation_resolved with three-tier recursion
-- ============================================================

create or replace view public.service_allocation_resolved as
with recursive
step_sums as (
  select
    service_id,
    department_id,
    sum(estimated_hours)::numeric as hours
  from public.process_steps
  where department_id is not null and estimated_hours is not null
  group by service_id, department_id
),
tree as (
  select
    s.id as root_id,
    s.id as node_id,
    1::int as quantity,
    0 as depth
  from public.services s

  union all

  select
    t.root_id,
    sc.child_id,
    (t.quantity * sc.quantity)::int,
    t.depth + 1
  from tree t
  join public.service_children sc on sc.parent_id = t.node_id
  where not exists (select 1 from step_sums ss where ss.service_id = t.node_id)
    and t.depth < 10
),
derived as (
  select
    t.root_id as service_id,
    ss.department_id,
    sum(ss.hours * t.quantity)::numeric as hours
  from tree t
  join step_sums ss on ss.service_id = t.node_id
  where not exists (select 1 from step_sums x where x.service_id = t.root_id)
     or t.node_id = t.root_id
  group by t.root_id, ss.department_id
),
derived_plus_price as (
  select
    d.service_id,
    d.department_id,
    d.hours,
    dep.hourly_rate_cents,
    s.sell_price_cents,
    s.pricing_model
  from derived d
  join public.services s on s.id = d.service_id
  join public.departments dep on dep.id = d.department_id
),
services_with_derived as (
  select distinct service_id from derived
),
rule_fallback as (
  select
    s.id as service_id,
    ra.department_id,
    case
      when s.pricing_model = 'percentage' or s.sell_price_cents <= 0 or dep.hourly_rate_cents <= 0
        then 0::numeric
      else round((ra.pct * s.sell_price_cents / dep.hourly_rate_cents / 100.0)::numeric, 2)
    end as hours,
    dep.hourly_rate_cents,
    s.sell_price_cents,
    s.pricing_model,
    ra.pct
  from public.services s
  join public.rule_allocations ra on ra.rule_id = s.rule_id
  join public.departments dep on dep.id = ra.department_id
  where s.rule_id is not null
    and not exists (select 1 from services_with_derived swd where swd.service_id = s.id)
)
select
  service_id,
  department_id,
  case
    when pricing_model = 'percentage' or sell_price_cents <= 0 then null
    else round((hours * hourly_rate_cents * 100.0 / sell_price_cents)::numeric, 2)
  end as pct,
  case
    when pricing_model = 'percentage' then 0
    else round(hours * hourly_rate_cents)::int
  end as price_share_cents,
  hours
from derived_plus_price

union all

select
  service_id,
  department_id,
  pct,
  case
    when pricing_model = 'percentage' then 0
    else round(hours * hourly_rate_cents)::int
  end as price_share_cents,
  hours
from rule_fallback;
