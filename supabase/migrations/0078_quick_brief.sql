-- Quick-brief without scoping: new intent bucket + terminal status + task trace.

-- 1. Allow the quick_task intent value (intent_type is text + CHECK, not an enum).
alter table public.briefs drop constraint if exists briefs_intent_type_check;
alter table public.briefs add constraint briefs_intent_type_check
  check (intent_type = any (array[
    'new_brief', 'project_thread', 'retainer_thread',
    'general_query', 'quick_response', 'quick_task'
  ]::text[]));

-- 2. Add the 'briefed' terminal status to the brief_status enum.
alter type public.brief_status add value if not exists 'briefed';

-- 3. Traceability + AI suggestion payload for quick tasks.
alter table public.briefs
  add column if not exists quick_task_suggestion jsonb,
  add column if not exists clickup_task_id text,
  add column if not exists clickup_task_url text;

comment on column public.briefs.quick_task_suggestion is
  'AI-suggested confirm-sheet prefill for quick_task briefs: {task_name, work_stream, sprint_points, due_date, assignee_hint}.';
comment on column public.briefs.clickup_task_id is
  'ClickUp task id created when a brief is quick-briefed (status=briefed).';
