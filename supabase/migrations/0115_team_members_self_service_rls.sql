-- 0115_team_members_self_service_rls.sql
--
-- Staff now sign in to the full app shell (nav + Systems + a profile page they
-- can edit), so "any authenticated user may write any team_members row" — the
-- single `team_members_authed_all` (ALL / USING true / WITH CHECK true) policy
-- this replaces — is no longer an acceptable trust boundary: it let a staff
-- session set its own role to 'owner', or rewrite anyone else's cost rate.
--
-- Shape:
--   SELECT  — still open to every authenticated user. Assignee pickers, member
--             colours, productivity rails and a dozen joins depend on reading
--             the whole roster; tightening it would break them and protects
--             nothing (the roster is internal-only data behind auth).
--   INSERT  — admin/owner, or self-provisioning your own row on first sign-in
--             (AuthContext upserts one for any @convertedclick.co.za account).
--             WITH CHECK pins role = 'staff' on the self-provision arm so a new
--             account cannot mint itself an owner row.
--   UPDATE  — admin/owner, or your own row. The privileged columns are held
--             immutable for non-admins by the trigger below, because a policy
--             can compare OLD and NEW only via a trigger.
--   DELETE  — admin/owner only. (The app archives rather than deletes; this
--             just stops a staff session from hard-deleting the roster.)
--
-- current_team_member_role() already resolves the shared team@ login to
-- 'owner', so the shared account keeps working.

-- Matching the caller by email as well as auth_user_id is required, not
-- belt-and-braces: AuthContext's first-sign-in backfill *writes* auth_user_id,
-- so at that moment the row is only reachable by email.
create or replace function public.is_own_team_member_row(m public.team_members)
returns boolean
language sql
stable
security definer
as $$
  select m.auth_user_id = auth.uid()
      or (m.email is not null
          and m.email = (select email from auth.users where id = auth.uid()));
$$;

create or replace function public.team_members_guard_privileged_columns()
returns trigger
language plpgsql
security definer
as $$
begin
  if current_team_member_role() in ('admin', 'owner') then
    return new;
  end if;
  -- Non-admin editing their own row: keep the columns that grant access or
  -- cost money exactly as they were, whatever the client sent.
  new.role              := old.role;
  new.cost_rate_cents   := old.cost_rate_cents;
  new.email             := old.email;
  new.archived_at       := old.archived_at;
  new.tracking_mode     := old.tracking_mode;
  -- auth_user_id may only ever be pointed at yourself (the sign-in backfill).
  if new.auth_user_id is distinct from old.auth_user_id
     and new.auth_user_id is distinct from auth.uid() then
    new.auth_user_id := old.auth_user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists team_members_guard_privileged_columns on public.team_members;
create trigger team_members_guard_privileged_columns
  before update on public.team_members
  for each row execute function public.team_members_guard_privileged_columns();

drop policy if exists team_members_authed_all on public.team_members;

create policy team_members_authed_read on public.team_members
  for select to authenticated
  using (true);

create policy team_members_insert on public.team_members
  for insert to authenticated
  with check (
    current_team_member_role() in ('admin', 'owner')
    or (
      email = (select email from auth.users where id = auth.uid())
      and role = 'staff'
    )
  );

create policy team_members_update on public.team_members
  for update to authenticated
  using (
    current_team_member_role() in ('admin', 'owner')
    or public.is_own_team_member_row(team_members)
  )
  with check (
    current_team_member_role() in ('admin', 'owner')
    or public.is_own_team_member_row(team_members)
  );

create policy team_members_delete on public.team_members
  for delete to authenticated
  using (current_team_member_role() in ('admin', 'owner'));
