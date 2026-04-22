-- 0006_quotes.sql
-- Apply via mcp__cc-supabase__apply_migration (name: quotes)

create type public.quote_status as enum (
  'draft', 'sent', 'accepted', 'rejected', 'superseded'
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.scopes(id),
  version int not null default 1,
  status public.quote_status not null default 'draft',
  sow_html text,
  sow_pdf_url text,
  line_items_jsonb jsonb not null default '[]'::jsonb,
  subtotal_cents bigint not null default 0,
  margin_pct numeric(5,2) not null default 0,
  discount_room_pct numeric(5,2) not null default 0,
  total_cents bigint not null default 0,
  xero_quote_id text,
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quotes_scope_version_idx on public.quotes (scope_id, version);
-- One non-superseded quote per scope at any time.
create unique index quotes_one_live_per_scope_idx
  on public.quotes (scope_id) where status <> 'superseded';

create table public.quote_services (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  service_id uuid not null references public.services(id),
  qty numeric(8,2) not null default 1,
  hours_override jsonb,
  allocation_override jsonb,
  notes text,
  ordinal int not null,
  created_at timestamptz not null default now()
);
create index quote_services_quote_ordinal_idx on public.quote_services (quote_id, ordinal);
