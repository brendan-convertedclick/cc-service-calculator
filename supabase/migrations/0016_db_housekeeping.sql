-- 0016_db_housekeeping.sql
-- Apply via mcp__cc-supabase__apply_migration (name: db_housekeeping)
--
-- Schema convention housekeeping. None of these are bugs in isolation, but
-- their absence breaks the "every table has updated_at + tg_touch_updated_at"
-- and "FKs over loose text" promises that the rest of the schema follows.
--
-- Sections:
--   1. Apply tg_touch_updated_at trigger to projects (updated_at exists, trigger never wired)
--   2. Add updated_at column + trigger to contacts
--   3. Convert scopes.locked_by and briefs.triaged_by from text to uuid FK to team_members
--   4. Partial index on projects(status) where status='in_progress' (cron sync filter)
--
-- All sections idempotent on re-apply.

-- ============================================================
-- 1. projects — wire missing tg_touch_updated_at trigger
-- ============================================================
-- `projects.updated_at` exists from 0007 but the trigger was never attached,
-- so manual `update public.projects ...` statements leave `updated_at` stale.

drop trigger if exists trg_projects_touch on public.projects;
create trigger trg_projects_touch before update on public.projects
  for each row execute function public.tg_touch_updated_at();

-- ============================================================
-- 2. contacts — add updated_at column + trigger
-- ============================================================
-- `contacts` (from 0005) only has `created_at`. We backfill `updated_at` from
-- `created_at` so existing rows get a meaningful timestamp, then enforce
-- NOT NULL + default now() for subsequent inserts/updates.

alter table public.contacts
  add column if not exists updated_at timestamptz;

update public.contacts
   set updated_at = created_at
 where updated_at is null;

alter table public.contacts
  alter column updated_at set not null,
  alter column updated_at set default now();

drop trigger if exists trg_contacts_touch on public.contacts;
create trigger trg_contacts_touch before update on public.contacts
  for each row execute function public.tg_touch_updated_at();

-- ============================================================
-- 3. scopes.locked_by / briefs.triaged_by — text -> uuid FK to team_members
-- ============================================================
-- Both columns currently store free-form text (name or email). Convert them
-- to proper uuid FKs so typos can't silently insert bogus data.
--
-- KNOWN CONCERN — best-effort backfill:
--   The backfill matches existing text values against team_members.full_name
--   and team_members.email (case-insensitive). Any text value that does not
--   match a current team_member is silently dropped to NULL. This is the
--   correct behaviour for type narrowing — we cannot safely guess who a
--   stale/misspelled name was meant to reference — but callers should be
--   aware: if prod has locked_by/triaged_by values that don't map, those
--   attribution records are lost. Review before applying if that matters.

-- scopes.locked_by ------------------------------------------------------

alter table public.scopes add column if not exists locked_by_uuid uuid;

update public.scopes s
   set locked_by_uuid = tm.id
  from public.team_members tm
 where s.locked_by_uuid is null
   and s.locked_by is not null
   and (lower(tm.full_name) = lower(s.locked_by)
        or lower(tm.email) = lower(s.locked_by));

alter table public.scopes drop column if exists locked_by;
alter table public.scopes rename column locked_by_uuid to locked_by;

alter table public.scopes
  drop constraint if exists scopes_locked_by_fkey,
  add constraint scopes_locked_by_fkey
    foreign key (locked_by) references public.team_members(id) on delete set null;

-- briefs.triaged_by -----------------------------------------------------

alter table public.briefs add column if not exists triaged_by_uuid uuid;

update public.briefs b
   set triaged_by_uuid = tm.id
  from public.team_members tm
 where b.triaged_by_uuid is null
   and b.triaged_by is not null
   and (lower(tm.full_name) = lower(b.triaged_by)
        or lower(tm.email) = lower(b.triaged_by));

alter table public.briefs drop column if exists triaged_by;
alter table public.briefs rename column triaged_by_uuid to triaged_by;

alter table public.briefs
  drop constraint if exists briefs_triaged_by_fkey,
  add constraint briefs_triaged_by_fkey
    foreign key (triaged_by) references public.team_members(id) on delete set null;

-- ============================================================
-- 4. projects(status) partial index — cron sync filter
-- ============================================================
-- supabase/functions/sync-clickup-actuals/index.ts runs every 30 min
-- (see 0011_cron_sync_actuals.sql) and filters projects by
-- `status = 'in_progress'`. Completed/cancelled projects are never polled,
-- so a partial index is both smaller than a full index and still fully
-- useful. Stays lean as the project count grows.

create index if not exists projects_status_in_progress_idx
  on public.projects (status)
  where status = 'in_progress';
