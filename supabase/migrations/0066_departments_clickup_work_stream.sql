-- 0066_departments_clickup_work_stream.sql
-- Apply via mcp__cc-supabase__apply_migration (name: departments_clickup_work_stream)
--
-- ClickUp's "Work Stream" dropdown option labels differ from some Conductor
-- department names (e.g. dept "Content & Copywriting" vs option "Content"), so
-- exact-match resolution silently leaves Work Stream blank on created tasks.
-- Adds an optional per-department override (NULL = use the department name).

alter table public.departments
  add column if not exists clickup_work_stream text;

update public.departments d
   set clickup_work_stream = v.cu
  from (values
    ('Content & Copywriting', 'Content'),
    ('Creative Production', 'Creative'),
    ('Software / Spend / Pass-Through / Non-Delivery', 'Software'),
    ('Video / 3D / Motion Production', '3D')
  ) as v(name, cu)
 where d.name = v.name
   and d.clickup_work_stream is distinct from v.cu;
