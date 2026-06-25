-- Scope Composer — give templates a department/area label so the /sow index can
-- offer a left-hand filter menu (and so generated SOWs carry their service area).
-- Additive. Apply via mcp__cc-supabase__apply_migration name 'sow_templates_department'.

alter table public.sow_templates
  add column if not exists department text;

comment on column public.sow_templates.department is
  'Scope Composer: service area / primary department for the /sow filter menu.';

create index if not exists sow_templates_department_idx
  on public.sow_templates (department);
