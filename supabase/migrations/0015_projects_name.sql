-- 0015_projects_name.sql
-- Apply via mcp__cc-supabase__apply_migration (name: projects_name)
--
-- Add denormalised name column to projects so the list page doesn't render
-- raw ClickUp task IDs. Backfill existing rows from briefs.raw_subject via
-- the projects → quotes → scopes → briefs chain.
--
-- Why denormalise: the human-readable name lives four joins away from
-- projects (projects.quote_id → quotes.scope_id → scopes.brief_id →
-- briefs.raw_subject). Copying it onto projects at insert time keeps the
-- Projects list page a single-table read and means the name survives even
-- if the upstream brief is later archived or hard-deleted.
--
-- Idempotency: uses the add-nullable / backfill / set NOT NULL pattern
-- from migration 0013. On first apply, every existing row matches
-- `where p.name is null` and gets the brief subject. On re-apply, no rows
-- match either UPDATE, so both are true no-ops.

-- 1. Add nullable, backfill, set NOT NULL.
alter table public.projects
  add column if not exists name text;

-- Walk the projects → quotes → scopes → briefs chain to copy the brief's
-- raw_subject onto the project. Coalesce to 'Untitled project' so an
-- empty subject still produces a NOT NULL-safe value.
update public.projects p
   set name = coalesce(b.raw_subject, 'Untitled project')
  from public.quotes q
  join public.scopes s on s.id = q.scope_id
  join public.briefs b on b.id = s.brief_id
 where p.quote_id = q.id
   and p.name is null;

-- Any orphan rows (quote/scope/brief gone) get a fallback name so NOT NULL holds.
update public.projects
   set name = coalesce(name, 'Untitled project')
 where name is null;

alter table public.projects
  alter column name set not null;
