-- 0128_step_email_template_link.sql
-- Apply via mcp__cc-supabase__apply_migration (name: step_email_template_link)
--
-- A step that sends an email points at the template it sends. One column, not
-- a join table: a step sends one email, and the moment it sends two it should
-- be two steps. Procedures attached to a step already have their own table
-- (process_step_procedures, 0114) because a stage really can have several.
--
-- on delete set null: retiring a template must not delete the step that used
-- it — the step still describes work, it just loses its shortcut.

alter table process_steps
  add column email_template_id uuid references email_templates(id) on delete set null;

create index process_steps_email_template_idx
  on process_steps (email_template_id)
  where email_template_id is not null;

comment on column process_steps.email_template_id is
  'The email_templates row this step sends, if any. Renders as a chip on the step and pre-loads the compose page.';

-- 0056 gave email_templates a read policy for admin/owner only and no write
-- policy at all — so nothing could ever edit one, and a staff member could not
-- see the template a step links to. Templates are agency standards: everyone
-- reads them (they are attached to a library anyone may write), admin/owner
-- decides what they say.
drop policy if exists email_templates_read on email_templates;

create policy email_templates_authed_read on email_templates
  for select to authenticated
  using (true);

create policy email_templates_admin_write on email_templates
  for all to authenticated
  using (current_team_member_role() = any (array['admin', 'owner']))
  with check (current_team_member_role() = any (array['admin', 'owner']));
