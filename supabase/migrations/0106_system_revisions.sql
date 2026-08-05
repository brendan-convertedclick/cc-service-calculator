-- 0106_system_revisions.sql
-- Apply via mcp__cc-supabase__apply_migration (name: system_revisions)
--
-- Phase 5: revisions and the publication gate. A system_definition's steps
-- are edited freely as process_steps rows, but ClickUp/provisioning only
-- ever reads a *published* revision — a versioned, approved snapshot. This
-- is the atomic publish machinery plus two carry-over fixes from 0105.

create table system_revisions (
  id                uuid primary key default gen_random_uuid(),
  system_id         uuid not null references system_definitions(id) on delete cascade,
  revision          int  not null,
  body              jsonb not null,       -- full snapshot of steps at publish time
  schema_version    int  not null default 1,
  state             text not null check (state in ('draft','proposed','published','superseded')),
  reason_for_change text not null,
  proposed_by       uuid references team_members(id),
  proposed_at       timestamptz,
  approved_by       uuid references team_members(id),
  approved_at       timestamptz,
  effective_date    date,
  supersedes_id     uuid references system_revisions(id),
  diff_summary      jsonb,                -- {added:[],removed:[],changed:[]}
  created_at        timestamptz not null default now(),
  unique (system_id, revision)
);

-- Exactly one live published revision per system, mirrors
-- quotes_one_live_per_scope_idx (0006).
create unique index system_revisions_one_live_idx
  on system_revisions (system_id) where state = 'published';

-- current_revision_id was added as a bare uuid in 0105 ("fk arrives in
-- Phase 5"); the table exists now. on delete set null so deleting a stray
-- revision never blocks on the system that points at it.
alter table system_definitions
  add constraint system_definitions_current_revision_id_fkey
  foreign key (current_revision_id) references system_revisions(id) on delete set null;

-- RLS: authenticated read, admin/owner write. Two-policy pattern from
-- 0058_phase8_full_planning + 0060, both `to authenticated`.
alter table system_revisions enable row level security;

create policy system_revisions_authed_read on system_revisions
  for select to authenticated using (true);

create policy system_revisions_admin_all on system_revisions
  for all to authenticated
  using (current_team_member_role() in ('admin','owner'))
  with check (current_team_member_role() in ('admin','owner'));

-- Fix 2a: 0105's system_definitions_admin_all omitted `to authenticated`
-- (harmless — current_team_member_role() is null for anon so it already
-- denies — but divergent from the house pattern). ALTER POLICY ... TO
-- preserves the existing USING/WITH CHECK expressions.
alter policy system_definitions_admin_all on system_definitions
  to authenticated;

-- Fix 2b: one service-kind (etc.) system per service/recurring
-- service/time category. Checked for existing duplicates first (none as of
-- this migration) — the backfill in 0105 was already not-exists-guarded.
create unique index system_definitions_one_per_service_idx
  on system_definitions (service_id) where kind = 'service' and archived_at is null;

create unique index system_definitions_one_per_recurring_idx
  on system_definitions (recurring_service_id) where kind = 'recurring' and archived_at is null;

create unique index system_definitions_one_per_internal_idx
  on system_definitions (time_category_id) where kind = 'internal' and archived_at is null;

-- Atomic publish: supersede the prior published row, publish the new one,
-- and point system_definitions.current_revision_id at it — all in one
-- transaction so a system can never end up with zero or two published
-- revisions. security definer so the role check below is the only gate
-- (mirrors current_team_member_role()/current_team_member_id() themselves).
create or replace function public.publish_system_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_system_id uuid;
  v_state     text;
  v_prev_id   uuid;
begin
  -- coalesce is load-bearing: `null not in (...)` evaluates to null, and
  -- `if null then` is treated as false in plpgsql, so a caller with no
  -- resolvable team_members row (not admin/owner, not staff, nothing) would
  -- silently fall through the guard without the coalesce.
  if coalesce(current_team_member_role(), '') not in ('admin', 'owner') then
    raise exception 'publish_system_revision: admin or owner role required';
  end if;

  select system_id, state into v_system_id, v_state
  from system_revisions
  where id = p_revision_id;

  if v_system_id is null then
    raise exception 'publish_system_revision: revision % not found', p_revision_id;
  end if;

  if v_state <> 'proposed' then
    raise exception 'publish_system_revision: revision % is %, not proposed', p_revision_id, v_state;
  end if;

  -- Supersede FIRST: system_revisions_one_live_idx is a non-deferrable
  -- unique index checked per-statement, so publishing the new row while the
  -- old one is still 'published' would violate it.
  update system_revisions
  set state = 'superseded'
  where system_id = v_system_id and state = 'published'
  returning id into v_prev_id;

  update system_revisions
  set state = 'published',
      supersedes_id = v_prev_id,
      approved_by = current_team_member_id(),
      approved_at = now()
  where id = p_revision_id;

  update system_definitions
  set current_revision_id = p_revision_id
  where id = v_system_id;
end;
$$;

grant execute on function public.publish_system_revision(uuid) to authenticated;

comment on function public.publish_system_revision(uuid) is
  'Phase 5: atomic publish — supersede prior published revision, publish this one, repoint system_definitions.current_revision_id. Caller must be admin/owner.';
