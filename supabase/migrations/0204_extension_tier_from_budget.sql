-- The approval tier of an extension request is decided here, not in the browser.
--
-- DEPLOY-DAY MIGRATION: do NOT apply until the form change that reads the returned
-- row (ExtensionFormBody) is merged and deployed, because production's old form
-- inserts its own tier/status and would be silently overridden. Apply, then add the
-- ledger row manually (supabase_migrations.schema_migrations).
--
-- Points leg: fits in Free -> auto, eats into To do -> admin, past what is left of
-- the budget -> owner (same rule and same 2dp figures as budgetVerdict in TS).
-- No budgeted retainer for the task -> the old rule, extra/original: <25 auto, <=50 admin, else owner.
-- Due-date leg: <=2 days auto, <=7 admin, else owner. Tier = the stricter leg.
-- Owner rows still enter at the admin leg, as initialStatusForTier does.

alter table extension_requests
  add column if not exists budget_project_id uuid,
  add column if not exists budget_free_hours numeric,
  add column if not exists budget_unspent_hours numeric;

create or replace function extension_requests_decide_tier() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_month text := to_char(now() at time zone 'Africa/Johannesburg', 'YYYY-MM');
  v_project uuid;
  v_budget numeric; v_spent numeric; v_todo numeric; v_found boolean := false;
  v_free numeric; v_unspent numeric; v_ask numeric;
  p_rank int := null; d_rank int := null; v_rank int; v_days int;
begin
  -- Which retainer the task books to: the newest brief on it, if it is a budgeted one.
  select parent_project_id into v_project from briefs
   where clickup_task_id = new.parent_clickup_task_id and parent_project_id is not null
   order by created_at desc limit 1;
  if v_project is not null then
    select max(budget_hours), coalesce(sum(spent_hours), 0), coalesce(sum(todo_hours), 0), true
      into v_budget, v_spent, v_todo, v_found
      from retainer_budget(v_month, new.client_id) where project_id = v_project;
    v_found := coalesce(v_found, false) and v_budget is not null;
  end if;

  if coalesce(new.extra_points, 0) > 0 then
    if v_found then
      v_free := round(v_budget - round(v_spent, 2) - round(v_todo, 2), 2);
      v_unspent := round(v_budget - round(v_spent, 2), 2);
      v_ask := new.extra_points * 0.25;
      p_rank := case when v_ask <= v_free then 0 when v_ask <= v_unspent then 1 else 2 end;
      new.budget_project_id := v_project;
      new.budget_free_hours := v_free;
      new.budget_unspent_hours := v_unspent;
    elsif coalesce(new.original_points, 0) > 0 then
      p_rank := case when new.extra_points / new.original_points * 100 < 25 then 0
                     when new.extra_points / new.original_points * 100 <= 50 then 1 else 2 end;
    end if;
    new.delta_pct := case when coalesce(new.original_points, 0) > 0
      then round(new.extra_points / new.original_points * 100, 2) end;
  else
    new.delta_pct := 0;
  end if;

  if new.requested_due_date is not null and new.original_due_date is not null then
    v_days := new.requested_due_date - new.original_due_date;
    if v_days > 0 then d_rank := case when v_days <= 2 then 0 when v_days <= 7 then 1 else 2 end; end if;
  end if;

  v_rank := greatest(p_rank, d_rank);  -- greatest ignores nulls
  if v_rank is not null then
    new.tier := (array['auto', 'admin', 'owner'])[v_rank + 1];
    new.status := case when v_rank = 0 then 'auto_approved' else 'pending_admin' end;
  end if;
  return new;
end $$;

drop trigger if exists extension_requests_decide_tier on extension_requests;
create trigger extension_requests_decide_tier before insert on extension_requests
  for each row execute function extension_requests_decide_tier();
