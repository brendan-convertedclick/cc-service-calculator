-- 0202_ongoing_task_books_to_retainer.sql
-- Apply via mcp__cc-supabase__apply_migration (name: ongoing_task_books_to_retainer)
--
-- An [Ongoing] bucket's time (Client Comms, Finance, Planning...) counts in the
-- Retainers Book's Tracked column against the retainer named here (Lisa,
-- 2026-10-29). Explicit rather than inherited from the list default (0171):
-- Dovetail's Admin list defaults to its Monthly Feedback Meeting retainer, and
-- account comms do not belong there. Null = counts nowhere.
alter table public.ongoing_tasks
  add column if not exists project_id uuid references public.projects (id) on delete set null;

comment on column public.ongoing_tasks.project_id is
  'The retainer this perpetual bucket''s tracked time counts against on the Retainers Book. Null = not booked.';
