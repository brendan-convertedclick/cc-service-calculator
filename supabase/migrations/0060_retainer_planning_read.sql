-- 0060: authenticated read access to retainer planning tables.
--
-- Phase 8 (0058) locked provisioned_tasks and retainer_recurring_services
-- behind current_team_member_role() IN ('admin','owner'). V1 runs on a single
-- shared login (team@…) that has no team_members row, so those policies
-- return zero rows in the app — the Retainers list sub-items view reads these
-- tables directly and needs SELECT. Writes stay admin/owner-only via the
-- existing *_admin_all policies.

DROP POLICY IF EXISTS rrs_authed_read ON retainer_recurring_services;
CREATE POLICY rrs_authed_read ON retainer_recurring_services
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS provisioned_tasks_authed_read ON provisioned_tasks;
CREATE POLICY provisioned_tasks_authed_read ON provisioned_tasks
  FOR SELECT TO authenticated USING (true);
