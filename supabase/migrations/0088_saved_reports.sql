-- Named, bookmarkable Reports-page views: a client + billing period saved under
-- a name, loaded from the Reports saved-reports dropdown. Builds on the URL-param
-- state (client/from/to) — loading a saved report just sets those params.

create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  created_by uuid references public.team_members(id),
  created_at timestamptz not null default now()
);

comment on table public.saved_reports is 'Named, bookmarkable Reports-page views (client + billing period). Loaded from the Reports saved-reports dropdown.';

alter table public.saved_reports enable row level security;

create policy saved_reports_authed_all
  on public.saved_reports for all to authenticated
  using (true) with check (true);
