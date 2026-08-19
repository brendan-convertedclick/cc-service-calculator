-- 0129_system_doc_links.sql
-- Apply via mcp__cc-supabase__apply_migration (name: system_doc_links)
--
-- A system points at the documents it depends on — a Google Doc, a spec, a
-- brand sheet. Just URLs: the thing people asked for is "open the doc from the
-- ClickUp task", and a label is one more field to leave blank.
--
-- text[] rather than a doc_links table: a link has no attributes of its own
-- (no ordinal anyone would reorder, no owner, no state), so a row per link
-- would be a join to fetch a string. Same reasoning as 0128's single
-- email_template_id column, pluralised because a system really can cite
-- several.
--
-- On system_definitions, not process_steps, and therefore on ALL FOUR kinds at
-- once — a policy, a process and a procedure are the same row with a different
-- `kind`, so one column covers the whole /systems library. Per-step links are
-- already possible today: process_steps.description ships to ClickUp inside
-- markdown_description, so a URL pasted into a step note reaches the task.
--
-- Deliberately NOT snapshotted into system_revisions.body. That snapshot is
-- process_steps only (useSystemRevisions builds it from a select('*') on the
-- steps), and freezing docs into it would be wrong anyway: when a Google Doc
-- moves, every task should get the new URL without republishing a revision.
--
-- not null default '{}' so every reader can treat it as an array and skip the
-- null branch; RLS needs nothing new — 0118 already opens system_definitions
-- writes to any authenticated user.

alter table system_definitions
  add column doc_links text[] not null default '{}';

comment on column system_definitions.doc_links is
  'Reference document URLs for this system. Rendered as a "Reference docs" section in the ClickUp task description on every push path, so the person doing the work can open them from ClickUp.';
