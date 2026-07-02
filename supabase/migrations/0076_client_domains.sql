-- 0076_client_domains.sql
-- Multiple domains per client.
--
-- A single client (e.g. the Pimms group) can own several domains —
-- stanton.global, 7twenty.tech, etc. The clients table only has a single
-- primary_domain, which can't represent a group. This table holds the extra
-- domains and is consulted by the conductor MCP tools evaluate-sender,
-- find-client, and list-client-domains alongside clients.primary_domain.
--
-- Domains are stored as bare lowercase hosts (no scheme/www/path); the MCP
-- normalises both sides at compare time regardless.

create table if not exists public.client_domains (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  domain text not null,
  created_at timestamptz not null default now()
);

-- one domain maps to at most one client
create unique index if not exists client_domains_domain_key
  on public.client_domains (lower(domain));

create index if not exists client_domains_client_id_idx
  on public.client_domains (client_id);

comment on table public.client_domains is
  'Additional domains owned by a client (multi-domain groups). Consulted by conductor MCP evaluate-sender/find-client/list-client-domains alongside clients.primary_domain.';
