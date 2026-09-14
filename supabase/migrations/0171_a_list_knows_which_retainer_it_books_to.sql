-- 0171_a_list_knows_which_retainer_it_books_to.sql
-- Apply via mcp__cc-supabase__apply_migration (name: a_list_knows_which_retainer_it_books_to)
--
-- The Retainers Book credits a retainer only through briefs parented to it.
-- Work that arrives from ClickUp — adopted tasks, quick briefs, staff briefs —
-- carries a client and a list but no retainer, so 31h of August's client work
-- and 25h of September's sat under no retainer at all (Lisa, 2026-09-14).
--
-- Most of the time the list already says which retainer: the Kings College
-- plugin-updates retainer lives in the Kings plugin-updates list. So a list
-- carries a default. It is filled automatically where exactly one live
-- retainer of the same client owns the list, and set by hand on the client
-- page for the rest (Trellidor's Adhoc Work list → the Adhoc Retainer, say).
-- A task nested under a retainer's ClickUp parent task wins over the default.

alter table public.client_lists
  add column if not exists default_project_id uuid references public.projects (id) on delete set null;

comment on column public.client_lists.default_project_id is
  'The retainer (or project) work in this ClickUp list is booked to when nothing more specific says otherwise. A task under a retainer''s ClickUp parent task overrides it. Null means the list''s work is ad hoc.';

-- Automatic defaults: a list that exactly one in-progress retainer of the
-- same client calls home.
update public.client_lists cl
set default_project_id = m.project_id
from (
  select p.clickup_list_id, p.client_id, min(p.id::text)::uuid as project_id
  from public.projects p
  where p.engagement_type = 'retainer'
    and p.status = 'in_progress'
    and p.clickup_list_id is not null
  group by p.clickup_list_id, p.client_id
  having count(*) = 1
) m
where cl.clickup_list_id = m.clickup_list_id
  and cl.client_id = m.client_id
  and cl.default_project_id is null;
