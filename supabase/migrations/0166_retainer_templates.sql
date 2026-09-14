-- 0166_retainer_templates.sql
-- Apply via mcp__cc-supabase__apply_migration (name: retainer_templates)
--
-- Lisa, 2026-09-10: "Is it possible to create a Internal Retainer, and save it
-- as a Template? If not can you build this out."
--
-- Internal retainers already worked — clients.is_internal (0152) or the
-- per-retainer switch (0162). Templates did not exist at all: sow_templates,
-- pipeline_templates and email_templates are the only template tables, and none
-- of them describes a retainer.
--
-- The book says the feature is worth having. Counting services that repeat
-- across clients:
--   * "Monthly Feedback Meeting" + "Update Meeting Agenda" — the same PAIR on
--     4–5 clients, and the shapes have already drifted apart (1×2pt on one,
--     1×4pt on another) purely because each was typed in by hand.
--   * The five "School Strategy - Social Media Figma Template" services — an
--     identical 5-service bundle on 3 clients.
--   * Website plugin updates, Google Ads Report, paid media feedback report —
--     two clients each, same shape.
-- Retyping those is where the drift comes from, so a template is the fix for a
-- real defect rather than a convenience.
--
-- WHAT A TEMPLATE HOLDS: the service list and its cadence/occurrence/points
-- shape. Deliberately NOT the fee, the hours target, the client, the ClickUp
-- list, or the assignees. A fee belongs to an agreement and an assignee belongs
-- to a person's workload — copying either between clients is how a template
-- starts telling lies. The wizard still asks for all four.

create table if not exists public.retainer_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text,
  -- What a retainer made from this should default to. A template for our own
  -- standing work (an internal retainer) should not have to be re-flagged
  -- every time it is used.
  is_internal boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.team_members(id) on delete set null
);

create unique index if not exists retainer_templates_name_live_uniq
  on public.retainer_templates (lower(name)) where archived_at is null;

create table if not exists public.retainer_template_services (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.retainer_templates(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  cadence text not null default 'monthly'
    check (cadence in ('daily', 'weekly', 'biweekly', 'monthly', 'custom')),
  -- Mirrors retainer_recurring_services' own checks: a recurring service that
  -- produces nothing is not one.
  occurrences_per_month numeric not null check (occurrences_per_month > 0),
  points_per_occurrence numeric not null check (points_per_occurrence > 0),
  is_live_eligible boolean not null default false,
  sort_order int not null default 0
);

create index if not exists retainer_template_services_template_idx
  on public.retainer_template_services (template_id);

alter table public.retainer_templates enable row level security;
alter table public.retainer_template_services enable row level security;

-- Same posture as the rest of the retainer tables: anyone signed in may read and
-- write. A template is a shared shape, not a personal setting, and gating it on
-- role would mean the person who spots the drift cannot fix it.
drop policy if exists retainer_templates_authed_all on public.retainer_templates;
create policy retainer_templates_authed_all on public.retainer_templates
  for all to authenticated using (true) with check (true);

drop policy if exists retainer_template_services_authed_all on public.retainer_template_services;
create policy retainer_template_services_authed_all on public.retainer_template_services
  for all to authenticated using (true) with check (true);

comment on table public.retainer_templates is
  'A reusable retainer shape: which recurring services, at what cadence and points. Holds no fee, no hours target, no client and no assignees — those belong to the agreement and the person, and copying them between clients is how a template starts lying.';
