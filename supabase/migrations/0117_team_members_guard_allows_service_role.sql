-- 0117_team_members_guard_allows_service_role.sql
--
-- Fixes a regression in 0115: RLS is bypassed by the service role, triggers
-- are not. For a service-role caller auth.uid() is null, so
-- current_team_member_role() is null and 0115's guard took the non-admin
-- branch — silently reverting auth_user_id (and pinning role, cost rate,
-- email, archived_at, tracking_mode) on every backend write, with no error.
-- That broke google-token's provisioning upsert, which is what links a
-- team_members row to its Supabase Auth user on first Google sign-in.
--
-- Letting a null uid through opens nothing: 0115's UPDATE policy evaluates
-- to null on both arms for a null uid, so an anonymous caller never reaches
-- this trigger. Only an RLS-bypassing service-role write does.

create or replace function public.team_members_guard_privileged_columns()
returns trigger
language plpgsql
security definer
as $$
begin
  if current_team_member_role() in ('admin', 'owner') or auth.uid() is null then
    return new;
  end if;
  new.role              := old.role;
  new.cost_rate_cents   := old.cost_rate_cents;
  new.email             := old.email;
  new.archived_at       := old.archived_at;
  new.tracking_mode     := old.tracking_mode;
  if new.auth_user_id is distinct from old.auth_user_id
     and new.auth_user_id is distinct from auth.uid() then
    new.auth_user_id := old.auth_user_id;
  end if;
  return new;
end;
$$;
