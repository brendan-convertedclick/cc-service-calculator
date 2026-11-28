-- 0212_outside_dismissals_need_a_person.sql
-- Apply via the Management API query endpoint (name: outside_dismissals_need_a_person)
--
-- Lisa, 2026-11-13: a dismissal from the shared team@ login names nobody, so
-- "Confirm internal" needs a personal login. team@ has no team_members row,
-- so current_team_member_id() is null for it. Undo stays open to anyone: it
-- puts the time back on the hidden total, which needs no one to answer for it.

drop policy if exists retainer_outside_dismissals_rw on retainer_outside_dismissals;

create policy retainer_outside_dismissals_read on retainer_outside_dismissals
  for select to authenticated using (true);
create policy retainer_outside_dismissals_insert on retainer_outside_dismissals
  for insert to authenticated with check (current_team_member_id() is not null and dismissed_by = current_team_member_id());
create policy retainer_outside_dismissals_delete on retainer_outside_dismissals
  for delete to authenticated using (true);
