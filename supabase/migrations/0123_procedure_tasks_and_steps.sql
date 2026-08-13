-- 0123_procedure_tasks_and_steps.sql
-- Apply via mcp__cc-supabase__apply_migration (name: procedure_tasks_and_steps)
--
-- A procedure is a run of TASKS; each task holds STEPS. A task is what ClickUp
-- gets; a step is a line on its checklist. That is the two-level nesting
-- process_steps has had since 0104 — top-level row = task, child row = step —
-- and it is exactly what planMaterialisation already turns into a task plus a
-- checklist. What was missing was the UI and the data: every procedure was
-- authored as a flat list of top-level rows, so nothing was ever a child.
--
-- Three things happen here.
--
-- 1. Sub-steps may carry hours. process_steps_substep_no_hours forbade it,
--    which was right when a sub-step was a nameless checklist line and wrong
--    now that it is the unit people estimate in. A task's estimate is the sum
--    of its steps, kept on the parent by the trigger below so every existing
--    reader (ChecklistSummary, SaveAsRuleModal, push-to-clickup) keeps summing
--    top-level rows and keeps getting the right number.
--
-- 2. Existing flat procedures are grouped into tasks. A run of consecutive
--    steps in the same department becomes one task named after that department,
--    and those steps become its checklist. This is not a cosmetic regroup: the
--    push already collapses every checklist_item step onto ONE service x
--    department task (firstChildTaskIdByService), so a 25-step build across 4
--    departments was landing all 25 items on whichever department came first.
--    Grouping is what makes the hand-offs real.
--
-- 3. system_edges are re-pointed from steps to the tasks that now contain them.
--    Edges inside a run vanish (they were never hand-offs); edges between runs
--    become the task-to-task chain.
--
-- kind='process' systems are left alone. Their blocks are stages that carry
-- procedures, not work that carries hours, and they materialise as 'none'.

-- ── 1. a step may be estimated ──────────────────────────────────────────────
alter table process_steps drop constraint if exists process_steps_substep_no_hours;

-- The parent's estimate is the sum of its children, maintained here rather than
-- derived at every call site: ChecklistSummary, SaveAsRuleModal, ProcessFlow and
-- push-to-clickup all read estimated_hours off top-level rows and would each
-- need their own rollup otherwise. sum() of an all-NULL set is NULL, which is
-- what we want — "not estimated" is not the same as zero.
create or replace function sync_parent_step_hours() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target uuid := coalesce(new.parent_id, old.parent_id);
begin
  if target is null then
    return coalesce(new, old);
  end if;
  update process_steps p
     set estimated_hours = (
           select sum(c.estimated_hours) from process_steps c where c.parent_id = target
         )
   where p.id = target;
  return coalesce(new, old);
end $$;

-- Fires on the child. A parent_id change touches two parents, so the UPDATE
-- trigger runs for the old one too via a second call with OLD.parent_id.
create or replace function sync_parent_step_hours_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.parent_id is distinct from new.parent_id and old.parent_id is not null then
    update process_steps p
       set estimated_hours = (
             select sum(c.estimated_hours) from process_steps c where c.parent_id = old.parent_id
           )
     where p.id = old.parent_id;
  end if;
  return new;
end $$;

drop trigger if exists process_steps_rollup_hours on process_steps;
create trigger process_steps_rollup_hours
  after insert or delete on process_steps
  for each row execute function sync_parent_step_hours();

drop trigger if exists process_steps_rollup_hours_upd on process_steps;
create trigger process_steps_rollup_hours_upd
  after update of estimated_hours, parent_id on process_steps
  for each row execute function sync_parent_step_hours();

drop trigger if exists process_steps_rollup_hours_move on process_steps;
create trigger process_steps_rollup_hours_move
  after update of parent_id on process_steps
  for each row execute function sync_parent_step_hours_move();

-- ── 2. group existing flat procedures into tasks ────────────────────────────
-- Snapshot first. This restructures procedures people actually wrote (a 25-step
-- Google Ads build, an 11-step WPForms form), and "regroup them differently"
-- is not something the UI can undo. Drop both tables once the new shape has
-- been reviewed:
--   drop table process_steps_pre_0123, system_edges_pre_0123;
create table if not exists process_steps_pre_0123 as
  select ps.* from process_steps ps
  join system_definitions sd on sd.id = ps.system_id
  where ps.parent_id is null and sd.kind <> 'process';

create table if not exists system_edges_pre_0123 as
  select e.* from system_edges e
  join system_definitions sd on sd.id = e.system_id
  where sd.kind <> 'process';

do $migrate$
declare
  moved int;
  made int;
begin
  -- Islands-and-gaps: consecutive rows sharing a department form one run.
  -- department_id IS NULL groups with itself, which is the behaviour we want —
  -- a stretch of undepartmented steps is one (invalid, red) task, not N.
  create temp table _steps on commit drop as
  select ps.id, ps.system_id, ps.service_id, ps.ordinal, ps.department_id, ps.owner_id,
         ps.pos_x, ps.pos_y, ps.estimated_hours,
         row_number() over (partition by ps.system_id order by ps.ordinal)
       - row_number() over (partition by ps.system_id, ps.department_id order by ps.ordinal) as grp
  from process_steps ps
  join system_definitions sd on sd.id = ps.system_id
  where ps.parent_id is null
    and sd.kind <> 'process';

  create temp table _runs on commit drop as
  select system_id,
         service_id,
         department_id,
         grp,
         min(ordinal)                                 as first_ordinal,
         (array_agg(owner_id order by ordinal))[1]    as owner_id,
         (array_agg(pos_x   order by ordinal))[1]     as pos_x,
         (array_agg(pos_y   order by ordinal))[1]     as pos_y,
         sum(estimated_hours)                         as hours,
         count(*)                                     as len,
         gen_random_uuid()                            as new_id,
         0                                            as run_index
  from _steps
  group by system_id, service_id, department_id, grp;

  update _runs r set run_index = x.rn
  from (
    select new_id, row_number() over (partition by system_id order by first_ordinal) as rn
    from _runs
  ) x
  where x.new_id = r.new_id;

  -- Parents land on a spare ordinal band first: the real 1..N slots are still
  -- held by the rows about to become their children, and
  -- process_steps_ordinal_idx is unique per (system, service, parent, ordinal).
  insert into process_steps
    (id, system_id, service_id, parent_id, ordinal, title, department_id, owner_id,
     estimated_hours, materialise_as, pos_x, pos_y, ai_generated)
  select r.new_id, r.system_id, r.service_id, null, 100000 + r.run_index,
         coalesce(d.name, 'Untitled task'),
         r.department_id, r.owner_id, r.hours, 'task', r.pos_x, r.pos_y, false
  from _runs r
  left join departments d on d.id = r.department_id;
  get diagnostics made = row_count;

  -- Moving the children out of the top-level bucket frees 1..N for the parents.
  -- The rollup trigger fires per child here and recomputes the parent's hours
  -- from scratch each time, which lands on the same total the insert above set.
  update process_steps ps
     set parent_id = m.new_id,
         ordinal   = m.pos
  from (
    select s.id,
           r.new_id,
           row_number() over (partition by r.new_id order by s.ordinal) as pos
    from _steps s
    join _runs r
      on r.system_id = s.system_id
     and r.grp = s.grp
     and r.department_id is not distinct from s.department_id
  ) m
  where ps.id = m.id;
  get diagnostics moved = row_count;

  update process_steps ps set ordinal = r.run_index
  from _runs r where ps.id = r.new_id;

  -- ── 3. re-point the flow onto the tasks ───────────────────────────────────
  -- Rebuilt rather than updated in place: system_edges is UNIQUE on
  -- (source, target), and two steps in the same run collapsing onto one task
  -- would collide mid-update.
  create temp table _map on commit drop as
  select s.id as old_id, r.new_id
  from _steps s
  join _runs r
    on r.system_id = s.system_id
   and r.grp = s.grp
   and r.department_id is not distinct from s.department_id;

  create temp table _newedges on commit drop as
  select distinct
         e.system_id,
         coalesce(ms.new_id, e.source_step_id) as src,
         coalesce(mt.new_id, e.target_step_id) as tgt,
         e.source_handle
  from system_edges e
  left join _map ms on ms.old_id = e.source_step_id
  left join _map mt on mt.old_id = e.target_step_id
  where e.system_id in (select distinct system_id from _runs);

  delete from system_edges where system_id in (select distinct system_id from _runs);

  insert into system_edges (system_id, source_step_id, target_step_id, source_handle)
  select system_id, src, tgt, min(source_handle)
  from _newedges
  where src <> tgt
  group by system_id, src, tgt;

  raise notice '0123: % task(s) created, % step(s) nested', made, moved;
end
$migrate$;

comment on column process_steps.estimated_hours is
'Hours for this row. On a step (parent_id set) it is what one checklist line is
worth; on a task (parent_id null) it is the sum of its steps, maintained by
process_steps_rollup_hours — so callers that read only top-level rows still see
the whole procedure. A task with no steps carries its own estimate directly.';
