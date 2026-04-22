-- 0018_quote_service_overrides.sql
-- Apply via mcp__cc-supabase__apply_migration (name: quote_service_overrides)
--
-- Replace quote_services.allocation_override and .hours_override (both
-- untyped jsonb) with a proper junction table keyed on
-- (quote_service_id, dept_id), with FKs and numeric typing.
--
-- Backfill explodes the jsonb into one row per (quote_service, dept) where
-- either jsonb has the dept_id as a key. After backfill, drop the jsonb
-- columns from quote_services.
--
-- Idempotency: create table if not exists; backfill INSERTs use ON CONFLICT
-- DO NOTHING so re-runs don't duplicate; column drops use IF EXISTS.

create table if not exists public.quote_service_overrides (
  quote_service_id uuid not null references public.quote_services(id) on delete cascade,
  dept_id uuid not null references public.departments(id),
  pct_override numeric(6,2),
  hours_override numeric(8,2),
  created_at timestamptz not null default now(),
  primary key (quote_service_id, dept_id)
);

-- RLS -- same pattern as every other public table
alter table public.quote_service_overrides enable row level security;
drop policy if exists quote_service_overrides_authed_all on public.quote_service_overrides;
create policy quote_service_overrides_authed_all
  on public.quote_service_overrides for all to authenticated
  using (true) with check (true);

-- Backfill: union dept_ids from both jsonb columns per quote_service.
-- Guarded so it only runs while the jsonb columns still exist (re-run safe).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_services'
      and column_name = 'allocation_override'
  ) then
    insert into public.quote_service_overrides (quote_service_id, dept_id, pct_override, hours_override)
    select
      qs.id,
      d.id,
      case when qs.allocation_override ? d.id::text
           then (qs.allocation_override->>d.id::text)::numeric end,
      case when qs.hours_override ? d.id::text
           then (qs.hours_override->>d.id::text)::numeric end
    from public.quote_services qs
      cross join public.departments d
    where qs.allocation_override ? d.id::text
       or qs.hours_override ? d.id::text
    on conflict (quote_service_id, dept_id) do nothing;
  end if;
end$$;

-- Drop the jsonb columns now that data lives in the new table.
alter table public.quote_services
  drop column if exists allocation_override,
  drop column if exists hours_override;
