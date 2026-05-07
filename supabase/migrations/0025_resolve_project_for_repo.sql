-- 0025_resolve_project_for_repo.sql
-- Apply via mcp__cc-supabase__apply_migration (name: resolve_project_for_repo)
--
-- Called by ~/.claude/hooks/sessionstart-cc-project.sh when no .cc-project
-- file is found at the project root. Looks up the project from a git
-- remote URL.
--
-- Normalisation: strips a trailing ".git", trailing slash, and lowercases
-- the host. github.com URLs in HTTPS and SSH form normalise to the same
-- canonical key (host/owner/repo).

create or replace function public.normalise_git_remote(remote text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
begin
  if remote is null or remote = '' then return null; end if;
  v := trim(remote);
  -- SSH form: git@github.com:org/repo.git → github.com/org/repo
  if v ~ '^git@' then
    v := regexp_replace(v, '^git@([^:]+):', 'https://\1/');
  end if;
  v := regexp_replace(v, '^https?://', '');
  v := regexp_replace(v, '\.git$', '');
  v := regexp_replace(v, '/$', '');
  return lower(v);
end;
$$;

create or replace function public.resolve_project_for_repo(remote text)
returns table (
  project_code text,
  project_name text,
  clickup_parent_task_id text,
  calculator_project_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.project_code,
    p.name as project_name,
    p.clickup_parent_task_id,
    p.id as calculator_project_id
  from public.projects p
  where p.git_remote_url is not null
    and public.normalise_git_remote(p.git_remote_url) = public.normalise_git_remote(remote)
    and p.status = 'in_progress'
  order by p.created_at desc
  limit 1;
$$;

-- Grant execute to anon — the hook calls this with the publishable key
-- so it works in any developer's terminal without per-user auth setup.
-- The function is read-only and exposes only the four fields above
-- (no PII beyond project name + ClickUp task ID, both already visible
-- to anyone with calculator access).
grant execute on function public.resolve_project_for_repo(text) to anon;
grant execute on function public.normalise_git_remote(text) to anon;
