-- 0105_system_kinds_materialise.sql
-- Apply via mcp__cc-supabase__apply_migration (name: system_kinds_materialise)
--
-- system_kind is created here but not wired into any table until Phase 4
-- (system_definitions) — that's intentional, not deferred by accident.
-- materialise_mode drives the per-step ClickUp artefact decision (Phase 3):
-- a step can become a task, roll up as a checklist item, or produce nothing.

do $$ begin
  create type system_kind as enum ('service','recurring','internal','reference');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type materialise_mode as enum ('task','checklist_item','none');
exception when duplicate_object then null;
end $$;

alter table process_steps
  add column if not exists materialise_as materialise_mode not null default 'task';

comment on column process_steps.materialise_as is
'How this step becomes a ClickUp artefact on push. Top-level step: task = its own
subtask (sub-steps become that task''s checklist); checklist_item = an item on the
service x department task; none = no ClickUp artefact, but the process_step_instance
row is still created so the workflow timeline stays complete. Sub-step (parent_id
set): this column is ignored — a sub-step is always a checklist item on its parent''s
task, or, if the parent itself is not materialise_as=task, it rolls up as a sibling
checklist item on the service x department task instead.';
