-- 0028_clients_wiki_path.sql
-- Phase 3 of Inbox v2: wiki context for AI scoping.

alter table public.clients add column wiki_path text;

-- Seed wiki_path for existing clients using a slug derived from name.
update public.clients
   set wiki_path = 'wiki/clients/' || regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')
 where wiki_path is null;

alter table public.scopes add column ai_context_snapshot text;
