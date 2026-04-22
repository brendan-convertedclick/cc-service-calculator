-- 0005_intake_pipeline.sql
-- Apply via mcp__cc-supabase__apply_migration (name: intake_pipeline)

create type public.brief_status as enum (
  'new', 'triaged', 'spam', 'needs_info', 'scoped',
  'quoted', 'accepted', 'rejected', 'archived'
);
create type public.brief_source as enum ('email', 'manual');

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  primary_domain text unique,
  xero_contact_id text,
  clickup_folder_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index clients_primary_domain_idx on public.clients (primary_domain);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null,
  full_name text,
  role text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index contacts_client_email_idx on public.contacts (client_id, email);

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id),
  source public.brief_source not null,
  received_at timestamptz not null default now(),
  sender_email text,
  raw_subject text,
  raw_body text not null,
  raw_attachments jsonb,
  gmail_thread_id text,
  status public.brief_status not null default 'new',
  triaged_by text,
  triaged_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index briefs_status_received_idx on public.briefs (status, received_at desc);
create index briefs_client_idx on public.briefs (client_id);

create table public.scopes (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.briefs(id) on delete cascade unique,
  enhanced_prose text,
  in_scope_md text,
  out_of_scope_md text,
  open_questions_md text,
  ai_drafted boolean not null default false,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
