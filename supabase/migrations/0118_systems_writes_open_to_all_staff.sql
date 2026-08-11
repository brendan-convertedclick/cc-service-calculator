-- 0118_systems_writes_open_to_all_staff.sql
--
-- The systems library is everyone's to write, not just admins'. Procedures
-- are documented by the people who run them, so gating writes on
-- admin/owner (0103-era policies, plus 0116 which pulled process_steps into
-- line with them) made the library read-only for exactly the people with the
-- knowledge to keep it accurate.
--
-- The one act that stays admin/owner is *publishing* a revision — that's the
-- approval step the whole revision model exists for. publish_system_revision
-- already raises 'admin or owner role required' on its own, and the
-- system_revisions policy below stops a direct insert from routing around it:
-- anyone may write a draft or proposed revision, only admin/owner may write a
-- published or superseded one.

-- system_definitions, system_edges, process_step_procedures, process_steps:
-- editing is editing. Read was already open on all four.
drop policy if exists system_definitions_admin_all on public.system_definitions;
create policy system_definitions_authed_write on public.system_definitions
  for all to authenticated
  using (true) with check (true);

drop policy if exists system_edges_admin_all on public.system_edges;
create policy system_edges_authed_write on public.system_edges
  for all to authenticated
  using (true) with check (true);

drop policy if exists process_step_procedures_admin_all on public.process_step_procedures;
create policy process_step_procedures_authed_write on public.process_step_procedures
  for all to authenticated
  using (true) with check (true);

drop policy if exists process_steps_admin_all on public.process_steps;
create policy process_steps_authed_write on public.process_steps
  for all to authenticated
  using (true) with check (true);

-- system_revisions: propose freely, publish by approval only.
drop policy if exists system_revisions_admin_all on public.system_revisions;

create policy system_revisions_propose on public.system_revisions
  for insert to authenticated
  with check (
    state in ('draft', 'proposed')
    or current_team_member_role() = any (array['admin', 'owner'])
  );

create policy system_revisions_edit on public.system_revisions
  for update to authenticated
  using (
    state in ('draft', 'proposed')
    or current_team_member_role() = any (array['admin', 'owner'])
  )
  with check (
    state in ('draft', 'proposed')
    or current_team_member_role() = any (array['admin', 'owner'])
  );

create policy system_revisions_delete on public.system_revisions
  for delete to authenticated
  using (current_team_member_role() = any (array['admin', 'owner']));
