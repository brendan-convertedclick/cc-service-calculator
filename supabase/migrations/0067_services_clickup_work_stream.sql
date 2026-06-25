-- 0067_services_clickup_work_stream.sql
-- Apply via mcp__cc-supabase__apply_migration (name: services_clickup_work_stream)
--
-- Work Stream is otherwise derived from a service's dominant department, but
-- some ClickUp Work Streams (Client Meeting, Internal Meeting, Client Sign Off,
-- …) are activity types with no matching Conductor department. This per-service
-- override (NULL = derive from department) lets such services set their ClickUp
-- Work Stream directly. Seeds the known meeting service.

alter table public.services
  add column if not exists clickup_work_stream text;

update public.services
   set clickup_work_stream = 'Client Meeting'
 where name = 'Meetings - Account manager costs'
   and clickup_work_stream is distinct from 'Client Meeting';
