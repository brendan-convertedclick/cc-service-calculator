-- 0008_settings.sql
-- Apply via mcp__cc-supabase__apply_migration (name: settings)

create table public.settings (
  id int primary key default 1 check (id = 1),
  xero_enabled boolean not null default false,
  xero_oauth_tokens jsonb,
  clickup_enabled boolean not null default false,
  clickup_pat text,
  clickup_workspace_id text,
  anthropic_enabled boolean not null default true,
  anthropic_model text not null default 'claude-sonnet-4-6',
  burn_sync_cron_minutes int not null default 30,
  inbound_email_secret text,
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (1);
