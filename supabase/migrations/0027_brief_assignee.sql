-- 0027_brief_assignee.sql
-- Phase 2 of Inbox v2: assignee model.

alter table public.briefs
  add column assignee_id uuid references public.team_members(id) on delete set null;

create index briefs_assignee_idx on public.briefs (assignee_id)
  where assignee_id is not null;
