-- 0046_pending_clients.sql
-- Apply via mcp__cc-supabase__apply_migration (name: pending_clients)

create table public.pending_clients (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  sample_sender text,
  sample_subject text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  seen_count    int not null default 1,
  dismissed_at  timestamptz
);

create unique index pending_clients_domain_unique
  on public.pending_clients (domain);
create index pending_clients_last_seen_idx
  on public.pending_clients (last_seen_at desc);

alter table public.pending_clients enable row level security;

create policy "authenticated read pending clients" on public.pending_clients
  for select to authenticated using (true);
create policy "authenticated write pending clients" on public.pending_clients
  for all to authenticated using (true) with check (true);
