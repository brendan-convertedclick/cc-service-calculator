-- 0116_process_steps_admin_writes.sql
--
-- Every other table in the systems feature already reads open / writes
-- admin+owner: system_definitions, system_revisions, system_edges,
-- process_step_procedures. process_steps was the one left on
-- `ALL / using true` — which was invisible while /systems sat behind the
-- admin route gate, and is a hole now that every signed-in person can open
-- the library. Without this the read-only Systems UI is decoration: a staff
-- session could still rewrite any procedure's steps straight through the API.
--
-- SELECT stays open (the whole point is that everyone can read procedures).
-- Reads from edge functions are unaffected — they only ever select here, and
-- the ones that write use the service-role client, which bypasses RLS.

drop policy if exists process_steps_authed_all on public.process_steps;

create policy process_steps_authed_read on public.process_steps
  for select to authenticated
  using (true);

create policy process_steps_admin_all on public.process_steps
  for all to authenticated
  using (current_team_member_role() = any (array['admin', 'owner']))
  with check (current_team_member_role() = any (array['admin', 'owner']));
