-- 0133_process_step_notes.sql
-- Apply via mcp__cc-supabase__apply_migration (name: process_step_notes)
--
-- A note on a task or a step, with a name and a date against it.
--
-- process_steps.description already held one note per row, but it is one
-- field: no author, no date, and no way to say a note has been dealt with.
-- It also does double duty — the canvas node renders it under the title and
-- the ClickUp push carries it — so it is procedure content, not an annotation,
-- and it stays exactly where it is. This table is the other thing: the running
-- commentary a team leaves on a procedure while running it.
--
-- created_by / done_by are NULLABLE on purpose. The shared team@ login has no
-- team_members row (see CLAUDE.md), so currentUserId is null for it — a
-- not-null author would make the panel unusable on the login most people use.
-- Both are `on delete set null`: an archived person's note is still the note.
--
-- The tick completes the NOTE, not the step. A procedure here is a template —
-- doing the work happens in ClickUp, and step completion belongs to the task
-- that got created from it.
--
-- system_id is stamped alongside step_id so the editor reads one query per
-- procedure instead of a key that churns every time a step is added.
--
-- Deliberately NOT part of a revision: system_revisions.body is built from
-- select('*') on process_steps, and a separate table stays out of it. Notes
-- are what happened while running the procedure, not what the procedure says.
--
-- RLS follows 0118 — the systems library is everyone's to write, and that
-- includes ticking off and clearing someone else's note.

create table if not exists public.process_step_notes (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.system_definitions(id) on delete cascade,
  step_id uuid not null references public.process_steps(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_by uuid references public.team_members(id) on delete set null
);

create index if not exists process_step_notes_system_idx on public.process_step_notes (system_id);
create index if not exists process_step_notes_step_idx on public.process_step_notes (step_id);

alter table public.process_step_notes enable row level security;

drop policy if exists process_step_notes_authed_read on public.process_step_notes;
create policy process_step_notes_authed_read on public.process_step_notes
  for select to authenticated using (true);

drop policy if exists process_step_notes_authed_write on public.process_step_notes;
create policy process_step_notes_authed_write on public.process_step_notes
  for all to authenticated
  using (true) with check (true);

comment on table public.process_step_notes is
  'Dated, attributed notes left on a task or step of a procedure. Separate from process_steps.description, which is procedure content and goes to ClickUp. done_at marks the NOTE as dealt with, not the step.';
