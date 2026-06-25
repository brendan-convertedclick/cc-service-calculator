-- Scope Composer — a modular, reusable visual SOW builder.
--
-- An SOW is an ordered array of typed Section nodes (prose | service_table |
-- clause | list | signature) stored as `body jsonb`. Templates are authored
-- ONCE with variable tokens ({{client.name}}, {{pricing.hourly_rate}}, …);
-- applying a template to a client SNAPSHOTS its body into a sow_documents row
-- and resolves variables through a sparse override chain
-- (document > client > registry default) so one template renders correctly for
-- every client with zero per-client template edits.
--
-- Pure resolvers live in src/lib/sow-variables.ts + src/lib/sow-doc.ts and are
-- a direct generalisation of buildScopeReceipt() (src/lib/scope-receipt.ts).
--
-- Conventions honoured: money = int cents; hours numeric(6,2); RLS authed_all
-- mirroring 0001_init; tg_touch_updated_at() touch trigger; schema_version on
-- every body jsonb for forward-compatible blob migration.
--
-- Additive only. Apply with mcp__cc-supabase__apply_migration
-- (project lpgwxacoqiqpcfpkklib, name 'sow_composer').

-- 1) Templates — reusable SOW skeletons (kind='template') and reusable
--    section/snippet library nodes shipped as kind='snippet'.
create table if not exists public.sow_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  kind text not null default 'template' check (kind in ('template', 'snippet')),
  master_sow_slug text references public.master_sows(slug),
  body jsonb not null default '[]'::jsonb,          -- ordered Section[] nodes
  schema_version int not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sow_templates_kind_idx on public.sow_templates (kind);

-- 2) Documents — an instance of a template applied to a client. body is a
--    SNAPSHOT taken at instantiation so later template edits never mutate a
--    SOW that has already been sent.
create table if not exists public.sow_documents (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.sow_templates(id) on delete set null,
  client_id uuid references public.clients(id) on delete cascade,
  brief_id uuid references public.briefs(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  title text not null default 'Untitled SOW',
  body jsonb not null default '[]'::jsonb,
  variable_overrides jsonb not null default '{}'::jsonb,  -- sparse per-document
  status text not null default 'draft' check (status in ('draft', 'final', 'sent')),
  rendered_pdf_url text,
  schema_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sow_documents_client_idx on public.sow_documents (client_id);
create index if not exists sow_documents_template_idx on public.sow_documents (template_id);

-- 3) Variables — the typed registry ('create once'). Dotted/namespaced keys
--    (client.name, pricing.hourly_rate, agency.vat_pct, document.date).
--    type='computed' carries an arithmetic expression over other keys.
create table if not exists public.sow_variables (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  label text,
  type text not null check (type in ('text', 'number', 'currency_cents', 'percent', 'date', 'boolean', 'enum', 'computed')),
  scope text not null check (scope in ('global', 'template', 'computed')),
  template_id uuid references public.sow_templates(id) on delete cascade,  -- null = global
  default_value jsonb,
  expression text,                                   -- for type='computed'
  enum_options jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, key)
);

-- 4) Content library — reusable section/snippet nodes (Proposify/PandaDoc
--    3rd granularity). node is a single Section node carrying its own variable
--    references, click-to-insert into any document body.
create table if not exists public.sow_library_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('prose', 'service_table', 'clause', 'list', 'signature')),
  node jsonb not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-client variable values — the 'apply once, many clients' layer. Sparse:
-- only overridden keys are present (presence-checked, so a 0/false override is
-- honoured and never silently reverts to the registry default).
alter table public.clients
  add column if not exists variable_overrides jsonb not null default '{}'::jsonb;
comment on column public.clients.variable_overrides is
  'Scope Composer: sparse per-client variable values; only overridden keys present. Presence (not truthiness) is the override test.';

-- RLS + touch triggers — same authed_all pattern as 0001_init.
do $$
declare t text;
begin
  foreach t in array array['sow_templates', 'sow_documents', 'sow_variables', 'sow_library_items']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_authed_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authed_all', t);
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.tg_touch_updated_at()',
      'trg_' || t || '_touch', t);
  end loop;
end $$;

-- Seed global variables. default_value is jsonb; 'null' means "no default, must
-- be filled". Presence-checked overrides honour 0/false.
insert into public.sow_variables (key, label, type, scope, default_value) values
  ('client.name',           'Client name',        'text',          'global', 'null'::jsonb),
  ('document.date',         'Document date',      'date',          'global', 'null'::jsonb),
  ('agency.vat_pct',        'VAT %',              'percent',       'global', '15'::jsonb),
  ('pricing.hourly_rate',   'Hourly rate (cents)','currency_cents','global', '0'::jsonb)
on conflict (template_id, key) do nothing;

-- Seed a computed total. pricing.subtotal_cents is auto-published into the bag
-- by each service_table section (= buildScopeReceipt billableTotalCents).
insert into public.sow_variables (key, label, type, scope, expression) values
  ('pricing.total_incl_vat_cents', 'Total incl VAT (cents)', 'computed', 'computed',
   'pricing.subtotal_cents * (1 + agency.vat_pct / 100)')
on conflict (template_id, key) do nothing;
