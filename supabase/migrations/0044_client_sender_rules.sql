-- 0044_client_sender_rules.sql
-- Apply via mcp__cc-supabase__apply_migration (name: client_sender_rules)

create type public.sender_rule_mode as enum ('allow', 'block');

create table public.client_sender_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  pattern text not null,
  mode public.sender_rule_mode not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pattern is either a full email (gregh@thekingscollege.co.za)
-- or a domain wildcard (*@thekingscollege.co.za). Stored lowercased.
create unique index client_sender_rules_unique
  on public.client_sender_rules (client_id, pattern);
create index client_sender_rules_client_idx
  on public.client_sender_rules (client_id);

create table public.pending_senders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sample_subject text,
  sample_brief_id uuid references public.briefs(id) on delete set null,
  seen_count int not null default 1
);
create unique index pending_senders_unique on public.pending_senders (client_id, email);
create index pending_senders_client_idx on public.pending_senders (client_id);

-- RLS — match siblings (clients table is wide-open in V1 single-tenant)
alter table public.client_sender_rules enable row level security;
alter table public.pending_senders enable row level security;

create policy "authenticated read sender rules" on public.client_sender_rules
  for select to authenticated using (true);
create policy "authenticated write sender rules" on public.client_sender_rules
  for all to authenticated using (true) with check (true);

create policy "authenticated read pending senders" on public.pending_senders
  for select to authenticated using (true);
create policy "authenticated write pending senders" on public.pending_senders
  for all to authenticated using (true) with check (true);

-- updated_at trigger using existing helper from 0001_init.sql
create trigger client_sender_rules_touch_updated_at
  before update on public.client_sender_rules
  for each row execute function public.tg_touch_updated_at();
