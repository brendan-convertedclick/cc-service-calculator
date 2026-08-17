-- 0126_system_revision_approvals.sql
-- Apply via mcp__cc-supabase__apply_migration (name: system_revision_approvals)
--
-- Who signed off a procedure, and when. 0107 stamped a single approved_by /
-- approved_at from whoever clicked Publish — that records the publisher, not
-- the people who actually agreed to the procedure. This is the named list:
-- one row per approver per revision, each with the datetime they completed
-- their sign-off, and each marked `required` (blocks publishing until signed)
-- or optional (a log entry, nothing waits on it).

create table system_revision_approvals (
  id             uuid primary key default gen_random_uuid(),
  revision_id    uuid not null references system_revisions(id) on delete cascade,
  team_member_id uuid not null references team_members(id),
  required       boolean not null default true,
  approved_at    timestamptz,            -- null = named but not yet signed off
  created_at     timestamptz not null default now(),
  unique (revision_id, team_member_id)
);

create index system_revision_approvals_revision_idx
  on system_revision_approvals (revision_id);

-- RLS mirrors 0118: the systems library is everyone's to write, and the
-- admin/owner gate lives on publishing (the RPC below), not on documenting
-- who agreed to what.
alter table system_revision_approvals enable row level security;

create policy system_revision_approvals_authed_all on system_revision_approvals
  for all to authenticated
  using (true)
  with check (true);

-- Publish now also enforces the sign-offs. Two rules, both raised before
-- anything is written:
--   1. at least one approver must be named — "who approved this" is a
--      required field, so an empty list is not a publishable revision;
--   2. every approver marked `required` must have an approved_at.
-- Optional approvers are a log; they never block.
create or replace function public.publish_system_revision(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_system_id  uuid;
  v_state      text;
  v_prev_id    uuid;
  v_total      int;
  v_unsigned   text;
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

  select count(*) into v_total
  from system_revision_approvals
  where revision_id = p_revision_id;

  if v_total = 0 then
    raise exception 'publish_system_revision: name who approved this procedure first — no approvers recorded';
  end if;

  select string_agg(tm.full_name, ', ' order by tm.full_name) into v_unsigned
  from system_revision_approvals a
  join team_members tm on tm.id = a.team_member_id
  where a.revision_id = p_revision_id and a.required and a.approved_at is null;

  if v_unsigned is not null then
    raise exception 'publish_system_revision: still waiting on required approval from %', v_unsigned;
  end if;

  -- Supersede FIRST: system_revisions_one_live_idx is a non-deferrable
  -- unique index checked per-statement, so publishing the new row while the
  -- old one is still 'published' would violate it.
  update system_revisions
  set state = 'superseded'
  where system_id = v_system_id and state = 'published'
  returning id into v_prev_id;

  -- approved_by/approved_at stay as they were: they record who published,
  -- which is a different fact from the sign-off list above.
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

comment on table system_revision_approvals is
  'Named sign-offs on a procedure revision: who approved and when. required=true blocks publish_system_revision until approved_at is set; required=false is a log entry only.';
