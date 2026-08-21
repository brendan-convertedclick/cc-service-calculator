-- 0135_process_step_note_assignee.sql
-- Apply via mcp__cc-supabase__apply_migration (name: process_step_note_assignee)
--
-- A note already records who wrote it (created_by). This is who has to do
-- something about it: a note left on someone else's step is a handover, and
-- until now the only way to say whose it was was to type a name into the body.
--
-- Nullable like created_by — a note filed for triage belongs to nobody yet,
-- and the shared team@ login has no team_members row to assign from anyway.
-- `on delete set null`: an archived person's note is still the note.
--
-- No RLS change: 0118/0133 already let any authenticated user write the row.

alter table public.process_step_notes
  add column if not exists assigned_to uuid references public.team_members(id) on delete set null;

comment on column public.process_step_notes.assigned_to is
  'Who the note is for. Null = unassigned. Staff filter the systems library on open notes assigned to them.';
