-- CC Service Calculator — checklist becomes allocation source of truth
-- Apply via mcp__cc-supabase__apply_migration (name: checklist_source_of_truth)

-- ============================================================
-- 1. Backfill process_steps from service_allocation_overrides
-- ============================================================

insert into public.process_steps (service_id, ordinal, title, description, department_id, estimated_hours, ai_generated)
select
  o.service_id,
  row_number() over (partition by o.service_id order by d.display_order, d.name) as ordinal,
  d.name || ' work' as title,
  null as description,
  o.department_id,
  greatest(0.25, round((o.pct * s.sell_price_cents / d.hourly_rate_cents / 100.0) / 0.25) * 0.25) as estimated_hours,
  false as ai_generated
from public.service_allocation_overrides o
  join public.services s on s.id = o.service_id
  join public.departments d on d.id = o.department_id
where s.sell_price_cents > 0
  and d.hourly_rate_cents > 0
  and not exists (
    -- Skip services that already have a checklist — don't clobber
    select 1 from public.process_steps ps where ps.service_id = o.service_id
  );

-- ============================================================
-- 2. Drop the sum-to-100 trigger on overrides (dead constraint on a deprecated table)
-- ============================================================

drop trigger if exists trg_service_override_sum on public.service_allocation_overrides;
drop function if exists public.tg_service_override_sum_guard();

comment on table public.service_allocation_overrides is
  'Deprecated 2026-04-21 — migrated into process_steps. Safe to drop after one release cycle.';

-- ============================================================
-- 3. Add minimum-hours check on process_steps
-- ============================================================

alter table public.process_steps
  add constraint process_steps_min_hours
  check (estimated_hours is null or estimated_hours >= 0.25);

-- ============================================================
-- 4. Rewrite service_allocation_resolved view
-- ============================================================

create or replace view public.service_allocation_resolved as
with
  -- Step-level sums per (service, department), only when steps have both a dept and hours
  step_sums as (
    select
      ps.service_id,
      ps.department_id,
      sum(ps.estimated_hours) as hours_sum
    from public.process_steps ps
    where ps.department_id is not null
      and ps.estimated_hours is not null
    group by ps.service_id, ps.department_id
  ),
  -- Services that have ANY non-null-dept, non-null-hours steps — these use checklist branch
  services_with_checklist as (
    select distinct service_id from step_sums
  )
select
  ss.service_id,
  ss.department_id,
  case
    when s.sell_price_cents > 0 and d.hourly_rate_cents > 0 then
      round(ss.hours_sum * d.hourly_rate_cents * 100.0 / s.sell_price_cents, 2)
    else null
  end as pct,
  round(ss.hours_sum * d.hourly_rate_cents)::int as price_share_cents,
  ss.hours_sum as hours
from step_sums ss
  join public.services s on s.id = ss.service_id
  join public.departments d on d.id = ss.department_id

union all

-- Fallback: services with no checklist but with a rule_id
select
  s.id as service_id,
  ra.department_id,
  ra.pct,
  round(s.sell_price_cents * ra.pct / 100.0)::int as price_share_cents,
  case
    when d.hourly_rate_cents > 0 then
      round((s.sell_price_cents * ra.pct / 100.0) / d.hourly_rate_cents, 2)
    else 0
  end as hours
from public.services s
  join public.rule_allocations ra on ra.rule_id = s.rule_id
  join public.departments d on d.id = ra.department_id
where s.id not in (select service_id from services_with_checklist);
