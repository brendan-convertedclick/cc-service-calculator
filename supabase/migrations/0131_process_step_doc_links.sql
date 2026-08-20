-- 0131_process_step_doc_links.sql
-- Apply via mcp__cc-supabase__apply_migration (name: process_step_doc_links)
--
-- A task points at the documents it needs. 0129 put doc_links on
-- system_definitions — the whole procedure's reference shelf — which is the
-- right home for "the brand sheet this procedure works from". It is the wrong
-- home for "the Google Doc THIS task writes into": every task in the procedure
-- inherited the same list, so a link that belonged to one step arrived on all
-- of them.
--
-- Same shape as 0129 deliberately: text[] rather than a join table, because a
-- link still has no attributes of its own, and the two lists are concatenated
-- by the push paths through the same renderDocLinks() — a doc reads identically
-- whether it hangs off the task or the procedure.
--
-- On process_steps, so it exists on sub-steps too. Only task rows
-- (materialise_as = 'task') surface it in the editor: a checklist item has
-- nowhere to put a link in ClickUp, so offering the field there would promise
-- something the push cannot keep.
--
-- Unlike 0129 this DOES land in system_revisions.body, because that snapshot is
-- built from select('*') on the steps. Harmless: the push paths read live
-- steps, so a moved document still updates every future task without
-- republishing. The snapshot just records what the links were at sign-off.
--
-- not null default '{}' so every reader can skip the null branch; RLS needs
-- nothing new — 0118 already opens process_steps writes to any authenticated
-- user.

alter table process_steps
  add column if not exists doc_links text[] not null default '{}';

comment on column process_steps.doc_links is
  'Reference document URLs for this task. Concatenated with the system''s own doc_links into the "Reference docs" section of the ClickUp task description, so the person doing the work can open them from ClickUp.';
