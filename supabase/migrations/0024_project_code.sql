-- 0024_project_code.sql
-- Apply via mcp__cc-supabase__apply_migration (name: project_code)
--
-- Adds the canonical cross-system reference code for projects: CC-<YY><seq4>
-- Generated server-side at insert time via a per-year counter function.
-- Stored unique + immutable on projects. Mirrored to ClickUp as a custom
-- field on the parent task and embedded in the .cc-project sidecar so
-- Claude Code SessionStart hooks can attribute token usage back to the
-- right ClickUp parent task.
--
-- Also adds git_remote_url so the SessionStart hook can resolve a project
-- from `git remote get-url origin` when no .cc-project file is present.

create or replace function public.generate_project_code()
returns text
language plpgsql
as $$
declare
  v_year text;
  v_seq int;
begin
  v_year := to_char(now() at time zone 'Africa/Johannesburg', 'YY');
  -- Per-year counter: count existing CC-<YY>* codes and add 1.
  -- Cheap because projects table is bounded (~200 rows/yr) and we only
  -- run this on insert.
  select coalesce(max(
    case
      when project_code like ('CC-' || v_year || '%')
        then substring(project_code from 6)::int
      else 0
    end
  ), 0) + 1
  into v_seq
  from public.projects;

  return 'CC-' || v_year || lpad(v_seq::text, 4, '0');
end;
$$;

alter table public.projects
  add column if not exists project_code text,
  add column if not exists git_remote_url text;

-- Backfill existing rows: assign codes in created_at order so older
-- projects get lower numbers within their year.
do $$
declare
  r record;
  v_year text;
  v_count_for_year int;
  v_year_counters jsonb := '{}'::jsonb;
begin
  for r in
    select id, created_at
      from public.projects
     where project_code is null
     order by created_at asc
  loop
    v_year := to_char(r.created_at at time zone 'Africa/Johannesburg', 'YY');
    v_count_for_year := coalesce((v_year_counters ->> v_year)::int, 0) + 1;
    v_year_counters := v_year_counters || jsonb_build_object(v_year, v_count_for_year);
    update public.projects
       set project_code = 'CC-' || v_year || lpad(v_count_for_year::text, 4, '0')
     where id = r.id;
  end loop;
end $$;

alter table public.projects
  alter column project_code set not null;

create unique index if not exists projects_project_code_idx
  on public.projects (project_code);

-- Default trigger: stamp project_code on insert if NULL. This lets the
-- Edge Function omit the column and rely on the DB to assign it, OR
-- pre-compute it client-side (e.g. for echoing into the UI before insert).
create or replace function public.tg_projects_assign_code()
returns trigger
language plpgsql
as $$
begin
  if new.project_code is null then
    new.project_code := public.generate_project_code();
  end if;
  return new;
end;
$$;

drop trigger if exists projects_assign_code on public.projects;
create trigger projects_assign_code
  before insert on public.projects
  for each row execute function public.tg_projects_assign_code();

-- Index on git_remote_url to support the resolve_project_for_repo RPC.
-- Partial index excludes nulls — older projects without a captured remote
-- don't bloat the index.
create index if not exists projects_git_remote_url_idx
  on public.projects (git_remote_url)
  where git_remote_url is not null;
