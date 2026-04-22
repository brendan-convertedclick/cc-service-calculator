-- 0009_list_aliases.sql
-- Apply via mcp__cc-supabase__apply_migration (name: list_aliases)
--
-- Seed data mirrors ~/.claude/skills/brief/references/list-aliases.md as of
-- 2026-04-22. Phase 3 refactor will make this the authoritative source and
-- point the /brief skill at this table; until then, the two must be kept in
-- sync manually when either changes.

create table public.list_aliases (
  id uuid primary key default gen_random_uuid(),
  work_stream text not null,
  aliases text[] not null,
  updated_at timestamptz not null default now()
);
create unique index list_aliases_work_stream_idx on public.list_aliases (work_stream);

create table public.list_alias_overrides (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  work_stream text not null,
  list_name text not null,
  created_at timestamptz not null default now()
);
create unique index list_alias_overrides_client_stream_idx
  on public.list_alias_overrides (client_id, work_stream);

insert into public.list_aliases (work_stream, aliases) values
  ('Development',  array['Development', 'Web', 'Dev', 'Website Design', 'Website Maintenance']),
  ('Paid Media',   array['Paid Media', 'Paid Media - RSA', 'Paid media']),
  ('Creative',     array['Creative', 'Creative Production', '3D']),
  ('SEO',          array['SEO']),
  ('Content',      array['Content']),
  ('Social Media', array['Social Media']),
  ('Admin',        array['Admin', 'Administration']),
  ('Strategy',     array['Strategy']);
