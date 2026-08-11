-- 0122_duplicate_system_and_step_slot.sql
-- Apply via mcp__cc-supabase__apply_migration (name: duplicate_system_and_step_slot)
--
-- Two authoring conveniences that both need the DB because they touch several
-- rows under a unique index:
--
--   duplicate_system  — copy a whole procedure/process: the definition, its
--                       steps (parent links remapped), its canvas edges and,
--                       for a process, the procedures attached to its blocks.
--                       Revisions are NOT copied: a copy has never been
--                       published, so it starts at revision 0.
--   open_step_slot    — free the ordinal directly after a step so a new or
--                       duplicated step lands next to it instead of at the end.
--
-- Neither is security definer: 0118 opened all four tables to any
-- authenticated user, so caller-rights RLS is already the right gate.

create or replace function public.duplicate_system(p_system_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_new_id uuid;
begin
  insert into system_definitions (
    name, kind, goal_statement, goal_metric, owner_id,
    service_id, recurring_service_id, time_category_id, band,
    trigger_text, definition_of_done, exceptions_md
  )
  select
    s.name || ' (copy)',
    -- system_definitions_one_per_service_idx (0107) is deliberately still in
    -- force, so a copy can't hang off the same service. It lands as a
    -- standalone reference procedure instead of failing the whole duplicate.
    case when s.kind = 'service' then 'reference'::system_kind else s.kind end,
    s.goal_statement, s.goal_metric,
    -- Whoever copies it owns it (matches the create path). The shared team@
    -- login has no team_members row, so this falls back to the source's owner.
    coalesce(current_team_member_id(), s.owner_id),
    case when s.kind = 'service' then null else s.service_id end,
    s.recurring_service_id, s.time_category_id, s.band,
    s.trigger_text, s.definition_of_done, s.exceptions_md
  from system_definitions s
  where s.id = p_system_id and s.archived_at is null
  returning id into v_new_id;

  if v_new_id is null then
    raise exception 'duplicate_system: system % not found', p_system_id;
  end if;

  -- Ids are generated up front so parent_id/edge endpoints can be remapped in
  -- one pass at any nesting depth — INSERT ... RETURNING can't hand back the
  -- source row it came from.
  create temp table _dup_map on commit drop as
    select id as old_id, gen_random_uuid() as new_id
    from process_steps where system_id = p_system_id;

  -- service_id is deliberately dropped: useProposeRevision and
  -- useProcessSteps both reach a service's steps by service_id, so a copy
  -- carrying it would show up inside the ORIGINAL service. system_id is set
  -- explicitly, which short-circuits tg_process_steps_stamp_system (0109).
  insert into process_steps (
    id, system_id, service_id, parent_id, ordinal, title, description,
    department_id, estimated_hours, ai_generated, materialise_as, keep_decision,
    goal_statement, definition_of_done, owner_id, pos_x, pos_y, verb,
    signal_q1, signal_q2, signal_q3, signal_q4, signal_q5
  )
  select
    m.new_id, v_new_id, null, pm.new_id, ps.ordinal, ps.title, ps.description,
    ps.department_id, ps.estimated_hours, ps.ai_generated, ps.materialise_as, ps.keep_decision,
    ps.goal_statement, ps.definition_of_done, ps.owner_id, ps.pos_x, ps.pos_y, ps.verb,
    ps.signal_q1, ps.signal_q2, ps.signal_q3, ps.signal_q4, ps.signal_q5
  from process_steps ps
  join _dup_map m on m.old_id = ps.id
  left join _dup_map pm on pm.old_id = ps.parent_id;

  insert into system_edges (system_id, source_step_id, target_step_id, label, source_handle)
  select v_new_id, sm.new_id, tm.new_id, e.label, e.source_handle
  from system_edges e
  join _dup_map sm on sm.old_id = e.source_step_id
  join _dup_map tm on tm.old_id = e.target_step_id
  where e.system_id = p_system_id;

  -- Only rows whose STEP belongs to the copied system: those are its blocks'
  -- attachments. Rows pointing AT this system as a procedure belong to some
  -- other process's blocks and must stay where they are.
  insert into process_step_procedures (step_id, system_id, ordinal)
  select m.new_id, psp.system_id, psp.ordinal
  from process_step_procedures psp
  join _dup_map m on m.old_id = psp.step_id;

  drop table _dup_map;
  return v_new_id;
end;
$$;

grant execute on function public.duplicate_system(uuid) to authenticated;

comment on function public.duplicate_system(uuid) is
  'Copy a system: definition + steps + edges + block attachments. Returns the new id. Revisions are not copied; a service procedure copies as a reference.';

create or replace function public.open_step_slot(p_step_id uuid)
returns int
language plpgsql
as $$
declare
  v_step process_steps%rowtype;
begin
  select * into v_step from process_steps where id = p_step_id;
  if not found then
    raise exception 'open_step_slot: step % not found', p_step_id;
  end if;

  -- process_steps_ordinal_idx is a non-deferrable unique index checked per
  -- row, so a plain `ordinal + 1` on the tail collides with the sibling ahead
  -- of it. Park the tail somewhere nothing uses, then bring it back one
  -- higher. `is not distinct from` matches the index's coalesce() bucket.
  update process_steps set ordinal = ordinal + 100000
  where system_id  is not distinct from v_step.system_id
    and service_id is not distinct from v_step.service_id
    and parent_id  is not distinct from v_step.parent_id
    and ordinal > v_step.ordinal;

  update process_steps set ordinal = ordinal - 99999
  where system_id  is not distinct from v_step.system_id
    and service_id is not distinct from v_step.service_id
    and parent_id  is not distinct from v_step.parent_id
    and ordinal > 100000;

  return v_step.ordinal + 1;
end;
$$;

grant execute on function public.open_step_slot(uuid) to authenticated;

comment on function public.open_step_slot(uuid) is
  'Shift every later sibling up one and return the now-free ordinal directly after p_step_id.';
