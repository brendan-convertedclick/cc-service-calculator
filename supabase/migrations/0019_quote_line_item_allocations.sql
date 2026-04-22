-- 0019_quote_line_item_allocations.sql
-- Apply via mcp__cc-supabase__apply_migration (name: quote_line_item_allocations)
--
-- Replace quotes.line_items_jsonb (opaque jsonb) with a flat snapshot table
-- keyed on (quote_id, ordinal, dept_id). Carries FKs to services/departments
-- AND immutable snapshot text fields (service_name, dept_name) so renames in
-- the live catalogue don't retroactively change accepted-quote history.
--
-- Backfill explodes existing line_items_jsonb arrays into one row per
-- (line × allocation). After backfill, drop the jsonb column.

create table if not exists public.quote_line_item_allocations (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  ordinal int not null,
  service_id uuid not null references public.services(id),
  service_name text not null,
  xero_code text,
  qty numeric(8,2) not null,
  unit_price_cents bigint not null,
  subtotal_cents bigint not null,
  dept_id uuid not null references public.departments(id),
  dept_name text not null,
  hours numeric(8,2) not null default 0,
  cost_share_cents bigint not null default 0,
  snapshot_version int not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists quote_line_item_allocations_quote_ordinal_idx
  on public.quote_line_item_allocations (quote_id, ordinal);

-- RLS — same authenticated_all pattern as the rest of the schema
alter table public.quote_line_item_allocations enable row level security;
drop policy if exists quote_line_item_allocations_authed_all on public.quote_line_item_allocations;
create policy quote_line_item_allocations_authed_all
  on public.quote_line_item_allocations for all to authenticated
  using (true) with check (true);

-- Backfill: explode the jsonb array into flat (line × allocation) rows. Guard
-- skips if line_items_jsonb has already been dropped so this migration is
-- safe to re-apply.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quotes'
      and column_name = 'line_items_jsonb'
  ) then
    insert into public.quote_line_item_allocations (
      quote_id, ordinal, service_id, service_name, xero_code, qty,
      unit_price_cents, subtotal_cents, dept_id, dept_name, hours, cost_share_cents
    )
    select
      q.id,
      (line.ordinality)::int,
      (line.value->>'service_id')::uuid,
      coalesce(line.value->>'service_name', '(unknown)'),
      line.value->>'xero_code',
      coalesce((line.value->>'qty')::numeric, 0),
      coalesce((line.value->>'unit_price_cents')::bigint, 0),
      coalesce((line.value->>'subtotal_cents')::bigint, 0),
      (alloc.value->>'dept_id')::uuid,
      coalesce(alloc.value->>'dept_name', '(unknown)'),
      coalesce((alloc.value->>'hours')::numeric, 0),
      coalesce((alloc.value->>'cost_share_cents')::bigint, 0)
    from public.quotes q
      cross join lateral jsonb_array_elements(q.line_items_jsonb) with ordinality as line(value, ordinality)
      cross join lateral jsonb_array_elements(line.value->'allocation') as alloc(value)
    where jsonb_typeof(q.line_items_jsonb) = 'array'
      and jsonb_array_length(q.line_items_jsonb) > 0
    on conflict do nothing;
  end if;
end $$;

alter table public.quotes drop column if exists line_items_jsonb;
