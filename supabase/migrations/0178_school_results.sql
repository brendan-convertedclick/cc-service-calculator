-- 0178_school_results.sql
--
-- School year results: a 12-month planner per client where the team plans
-- what will go out, attaches results after the month, and compares years.
-- Spec: docs/superpowers/specs/2026-09-28-school-year-results-design.md
--
-- Load-bearing rules:
--  1. One master template library (results_templates/results_template_fields),
--     global and shared by every client. Groups/rows point at a template;
--     there are no per-client copies.
--  2. A field's uuid is its identity. Renaming never detaches past values —
--     values key on field_id, not on label.
--  3. Retired, never deleted: retired_at hides a field from new entry; old
--     values stay and the FK from values to fields is `on delete restrict`.
--  4. A field's type locks once any value row references it (trigger below).
--  5. At most two starred result fields per template (trigger below); the
--     first by ordinal is what a compared year shows on the grid.
--  6. A numeric result field may name a numeric plan field in the same
--     template as its target (target_field_id).
--  7. Rows are not per-year — a row persists across years, which is what
--     makes years comparable. Entries key on (row_id, year, month).
-- Idempotent: safe to re-run (if not exists / or replace / drop policy if
-- exists / seed keyed on template name via on conflict do nothing).

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.results_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.results_template_fields (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.results_templates(id) on delete cascade,
  label text not null,
  short_label text,
  type text not null check (type in ('number', 'money', 'percent', 'date', 'text')),
  phase text not null check (phase in ('plan', 'result')),
  star boolean not null default false,
  target_field_id uuid references public.results_template_fields(id) on delete set null,
  ordinal int not null default 0,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- rule 5: only a result-phase field may be starred
  check (not star or phase = 'result')
);

create index if not exists results_template_fields_template_id_idx
  on public.results_template_fields(template_id);
create index if not exists results_template_fields_target_field_id_idx
  on public.results_template_fields(target_field_id);

create table if not exists public.results_groups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  colour text not null check (colour in ('violet', 'teal', 'amber', 'rose', 'blue', 'green')),
  template_id uuid not null references public.results_templates(id) on delete restrict,
  ordinal int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists results_groups_client_id_idx on public.results_groups(client_id);
create index if not exists results_groups_template_id_idx on public.results_groups(template_id);

create table if not exists public.results_rows (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.results_groups(id) on delete cascade,
  name text not null,
  -- null = use the group's template; set only to override it for this row
  template_id uuid references public.results_templates(id) on delete restrict,
  ordinal int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists results_rows_group_id_idx on public.results_rows(group_id);
create index if not exists results_rows_template_id_idx on public.results_rows(template_id);

create table if not exists public.results_entries (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references public.results_rows(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  created_by uuid references public.team_members(id) on delete set null,
  updated_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (row_id, year, month)
);

create index if not exists results_entries_row_id_idx on public.results_entries(row_id);

create table if not exists public.results_entry_values (
  entry_id uuid not null references public.results_entries(id) on delete cascade,
  field_id uuid not null references public.results_template_fields(id) on delete restrict,
  num_value numeric,
  text_value text,
  date_value date,
  primary key (entry_id, field_id)
);

create index if not exists results_entry_values_field_id_idx on public.results_entry_values(field_id);

-- ============================================================
-- Triggers
-- ============================================================

-- updated_at touch, reusing the shared function from 0001_init.sql.
drop trigger if exists trg_results_templates_touch on public.results_templates;
create trigger trg_results_templates_touch before update on public.results_templates
  for each row execute function public.tg_touch_updated_at();
drop trigger if exists trg_results_template_fields_touch on public.results_template_fields;
create trigger trg_results_template_fields_touch before update on public.results_template_fields
  for each row execute function public.tg_touch_updated_at();
drop trigger if exists trg_results_groups_touch on public.results_groups;
create trigger trg_results_groups_touch before update on public.results_groups
  for each row execute function public.tg_touch_updated_at();
drop trigger if exists trg_results_rows_touch on public.results_rows;
create trigger trg_results_rows_touch before update on public.results_rows
  for each row execute function public.tg_touch_updated_at();
drop trigger if exists trg_results_entries_touch on public.results_entries;
create trigger trg_results_entries_touch before update on public.results_entries
  for each row execute function public.tg_touch_updated_at();

-- Rule 4: a field's type locks once any value row references it.
create or replace function public.tg_results_field_type_lock()
returns trigger language plpgsql as $$
begin
  if new.type is distinct from old.type
     and exists (select 1 from public.results_entry_values where field_id = new.id)
  then
    raise exception 'cannot change type of a field that already has values';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_results_template_fields_type_lock on public.results_template_fields;
create trigger trg_results_template_fields_type_lock
  before update on public.results_template_fields
  for each row execute function public.tg_results_field_type_lock();

-- Rule 5: at most two starred result fields per template.
create or replace function public.tg_results_field_max_two_stars()
returns trigger language plpgsql as $$
begin
  if new.star and (
    select count(*) from public.results_template_fields
    where template_id = new.template_id
      and star
      and id <> new.id
  ) >= 2 then
    raise exception 'a template may have at most two starred fields';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_results_template_fields_max_two_stars on public.results_template_fields;
create trigger trg_results_template_fields_max_two_stars
  before insert or update on public.results_template_fields
  for each row execute function public.tg_results_field_max_two_stars();

-- ============================================================
-- RLS
-- ============================================================

alter table public.results_templates enable row level security;
alter table public.results_template_fields enable row level security;
alter table public.results_groups enable row level security;
alter table public.results_rows enable row level security;
alter table public.results_entries enable row level security;
alter table public.results_entry_values enable row level security;

-- Templates and fields: read for everyone, write admin/owner only.
drop policy if exists results_templates_select on public.results_templates;
create policy results_templates_select on public.results_templates
  for select to authenticated using (true);
drop policy if exists results_templates_admin_write on public.results_templates;
create policy results_templates_admin_write on public.results_templates
  for all to authenticated
  using (current_team_member_role() in ('admin', 'owner'))
  with check (current_team_member_role() in ('admin', 'owner'));

drop policy if exists results_template_fields_select on public.results_template_fields;
create policy results_template_fields_select on public.results_template_fields
  for select to authenticated using (true);
drop policy if exists results_template_fields_admin_write on public.results_template_fields;
create policy results_template_fields_admin_write on public.results_template_fields
  for all to authenticated
  using (current_team_member_role() in ('admin', 'owner'))
  with check (current_team_member_role() in ('admin', 'owner'));

-- Groups, rows, entries, values: everyone may read and write (0118 stance —
-- staff record results the same way they document procedures).
drop policy if exists results_groups_select on public.results_groups;
create policy results_groups_select on public.results_groups
  for select to authenticated using (true);
drop policy if exists results_groups_authed_write on public.results_groups;
create policy results_groups_authed_write on public.results_groups
  for all to authenticated using (true) with check (true);

drop policy if exists results_rows_select on public.results_rows;
create policy results_rows_select on public.results_rows
  for select to authenticated using (true);
drop policy if exists results_rows_authed_write on public.results_rows;
create policy results_rows_authed_write on public.results_rows
  for all to authenticated using (true) with check (true);

drop policy if exists results_entries_select on public.results_entries;
create policy results_entries_select on public.results_entries
  for select to authenticated using (true);
drop policy if exists results_entries_authed_write on public.results_entries;
create policy results_entries_authed_write on public.results_entries
  for all to authenticated using (true) with check (true);

drop policy if exists results_entry_values_select on public.results_entry_values;
create policy results_entry_values_select on public.results_entry_values
  for select to authenticated using (true);
drop policy if exists results_entry_values_authed_write on public.results_entry_values;
create policy results_entry_values_authed_write on public.results_entry_values
  for all to authenticated using (true) with check (true);

-- ============================================================
-- Seed: the six master templates from the mockup (TPL block).
-- Idempotent via on conflict do nothing keyed on template name / (template,label).
-- ============================================================

do $$
declare
  tpl_id uuid;
  fid_a uuid; -- first inserted field this template that a later field targets
  fid_b uuid;
begin
  -- Paid channel
  insert into public.results_templates (name) values ('Paid channel')
    on conflict (name) do nothing;
  select id into tpl_id from public.results_templates where name = 'Paid channel';
  if not exists (select 1 from public.results_template_fields where template_id = tpl_id) then
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'What we''ll run', null, 'text', 'plan', false, 0)
      returning id into fid_a; -- 'what'
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Budget', 'budget', 'money', 'plan', false, 1);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Target leads', 'target', 'number', 'plan', false, 2)
      returning id into fid_b; -- 'tleads', targeted by 'leads'
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Spend', 'spent', 'money', 'result', true, 3);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, target_field_id, ordinal)
      values (tpl_id, 'Leads', 'leads', 'number', 'result', true, fid_b, 4);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Clicks', 'clicks', 'number', 'result', false, 5);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'What we''d change', null, 'text', 'result', false, 6);
  end if;

  -- Social
  insert into public.results_templates (name) values ('Social')
    on conflict (name) do nothing;
  select id into tpl_id from public.results_templates where name = 'Social';
  if not exists (select 1 from public.results_template_fields where template_id = tpl_id) then
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Theme', null, 'text', 'plan', false, 0);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Posts planned', 'planned', 'number', 'plan', false, 1)
      returning id into fid_b; -- 'posts', targeted by 'out'
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, target_field_id, ordinal)
      values (tpl_id, 'Posts out', 'posts', 'number', 'result', false, fid_b, 2);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Reach', 'reach', 'number', 'result', true, 3);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Engagement rate', 'eng.', 'percent', 'result', true, 4);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'What we''d change', null, 'text', 'result', false, 5);
  end if;

  -- Guide
  insert into public.results_templates (name) values ('Guide')
    on conflict (name) do nothing;
  select id into tpl_id from public.results_templates where name = 'Guide';
  if not exists (select 1 from public.results_template_fields where template_id = tpl_id) then
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Title', null, 'text', 'plan', false, 0);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Target keyword', null, 'text', 'plan', false, 1);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Published on', null, 'date', 'result', false, 2);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Visits', 'visits', 'number', 'result', true, 3);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Enquiries from it', 'enquiries', 'number', 'result', true, 4);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'What we''d change', null, 'text', 'result', false, 5);
  end if;

  -- Open day
  insert into public.results_templates (name) values ('Open day')
    on conflict (name) do nothing;
  select id into tpl_id from public.results_templates where name = 'Open day';
  if not exists (select 1 from public.results_template_fields where template_id = tpl_id) then
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Date', null, 'date', 'plan', false, 0);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Target families', 'target', 'number', 'plan', false, 1)
      returning id into fid_b; -- 'tfam', targeted by 'fam'
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, target_field_id, ordinal)
      values (tpl_id, 'Families attended', 'families', 'number', 'result', true, fid_b, 2);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Applications after', 'applications', 'number', 'result', true, 3);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'What we''d change', null, 'text', 'result', false, 4);
  end if;

  -- Event
  insert into public.results_templates (name) values ('Event')
    on conflict (name) do nothing;
  select id into tpl_id from public.results_templates where name = 'Event';
  if not exists (select 1 from public.results_template_fields where template_id = tpl_id) then
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'What''s happening', null, 'text', 'plan', false, 0);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Attendance', 'attended', 'number', 'result', true, 1);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'What we''d change', null, 'text', 'result', false, 2);
  end if;

  -- Campaign
  insert into public.results_templates (name) values ('Campaign')
    on conflict (name) do nothing;
  select id into tpl_id from public.results_templates where name = 'Campaign';
  if not exists (select 1 from public.results_template_fields where template_id = tpl_id) then
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'What it''s for', null, 'text', 'plan', false, 0);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Target enquiries', 'target', 'number', 'plan', false, 1)
      returning id into fid_b; -- 'tenq', targeted by 'enq'
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, target_field_id, ordinal)
      values (tpl_id, 'Enquiries', 'enquiries', 'number', 'result', true, fid_b, 2);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'Tours booked', 'tours', 'number', 'result', true, 3);
    insert into public.results_template_fields (template_id, label, short_label, type, phase, star, ordinal)
      values (tpl_id, 'What we''d change', null, 'text', 'result', false, 4);
  end if;
end $$;
