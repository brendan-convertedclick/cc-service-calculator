-- 0021_enable_rls_on_intake_pipeline.sql
-- Apply via mcp__cc-supabase__apply_migration (name: enable_rls_on_intake_pipeline)
--
-- Advisor-level security fix: 9 user-facing tables had no RLS at all. They were
-- created in migrations 0005–0011 which were applied via direct SQL bypass in
-- the live project, so the RLS + policy statements in those migration files
-- never ran. The `anon` role inherited the default GRANTs from supabase's
-- postgrest role, making every row in these tables readable by anyone holding
-- the publishable key (which ships inside the browser bundle).
--
-- This migration applies the same `authenticated_all` RLS pattern used by
-- every other public table in 0001.
--
-- Idempotent: `enable row level security` is a no-op if already on, and each
-- policy is guarded with `drop policy if exists`.

alter table public.clients            enable row level security;
alter table public.contacts           enable row level security;
alter table public.briefs             enable row level security;
alter table public.scopes             enable row level security;
alter table public.quotes             enable row level security;
alter table public.quote_services     enable row level security;
alter table public.projects           enable row level security;
alter table public.project_actuals    enable row level security;
alter table public.settings           enable row level security;

drop policy if exists clients_authed_all on public.clients;
create policy clients_authed_all on public.clients
  for all to authenticated using (true) with check (true);

drop policy if exists contacts_authed_all on public.contacts;
create policy contacts_authed_all on public.contacts
  for all to authenticated using (true) with check (true);

drop policy if exists briefs_authed_all on public.briefs;
create policy briefs_authed_all on public.briefs
  for all to authenticated using (true) with check (true);

drop policy if exists scopes_authed_all on public.scopes;
create policy scopes_authed_all on public.scopes
  for all to authenticated using (true) with check (true);

drop policy if exists quotes_authed_all on public.quotes;
create policy quotes_authed_all on public.quotes
  for all to authenticated using (true) with check (true);

drop policy if exists quote_services_authed_all on public.quote_services;
create policy quote_services_authed_all on public.quote_services
  for all to authenticated using (true) with check (true);

drop policy if exists projects_authed_all on public.projects;
create policy projects_authed_all on public.projects
  for all to authenticated using (true) with check (true);

drop policy if exists project_actuals_authed_all on public.project_actuals;
create policy project_actuals_authed_all on public.project_actuals
  for all to authenticated using (true) with check (true);

drop policy if exists settings_authed_all on public.settings;
create policy settings_authed_all on public.settings
  for all to authenticated using (true) with check (true);
