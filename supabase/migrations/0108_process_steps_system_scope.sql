-- 0108_process_steps_system_scope.sql
-- APPLIED to lpgwxacoqiqpcfpkklib on 2026-08-06 as `process_steps_system_scope`.
-- Re-runnable: every statement below is idempotent.
--
-- Fixes two defects found auditing Phases 2-6. Both were latent on the data at
-- the time (2 process_steps rows, 0 with service_id null) and both bite the
-- first time anyone gives a system its own steps.
--
-- D1  process_steps_ordinal_idx (0103) keys on
--     (coalesce(service_id,S), coalesce(parent_id,S), ordinal). 0105 added
--     system_id and made service_id nullable but never widened the index, so
--     two DIFFERENT systems each holding a top-level step at the same ordinal
--     collide: both rows coalesce to (S, S, 1). Proven live in a rolled-back
--     probe: "duplicate key value violates unique constraint
--     process_steps_ordinal_idx".
--
-- D2  Only the 0105 backfill ever stamped system_id. The service editor's
--     write paths (useCreateStep via ProcessFlow.addStep, useReplaceSteps,
--     useSetServiceChecklist) all insert service_id with no system_id, so the
--     moment anyone edits a service's steps its kind='service' system reads
--     as stepless: /systems/:id shows "No steps yet", the canvas shows its
--     empty state, and the list's step_count drops to 0 — while
--     /services/:id still shows the steps. useSystemRevisions.ts already
--     works around this in ONE place with `.or(system_id.eq,service_id.eq)`;
--     stamping at the source fixes every reader instead of that one.

-- D1 --------------------------------------------------------------------
-- Strictly more permissive than the index it replaces (an extra leading key
-- column can only reduce collisions), so no existing row can violate it.
drop index if exists process_steps_ordinal_idx;

create unique index if not exists process_steps_ordinal_idx
  on process_steps (coalesce(system_id,  '00000000-0000-0000-0000-000000000000'::uuid),
                    coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    coalesce(parent_id,  '00000000-0000-0000-0000-000000000000'::uuid),
                    ordinal);

-- D2 --------------------------------------------------------------------
-- A sub-step inherits its parent's system; a service-linked step takes the
-- kind='service' system for that service (unique per service while
-- archived_at is null — system_definitions_one_per_service_idx, 0106).
-- Only ever FILLS a null; never overwrites an explicit system_id.
create or replace function public.tg_process_steps_stamp_system()
returns trigger
language plpgsql
as $$
begin
  if new.system_id is not null then
    return new;
  end if;

  if new.parent_id is not null then
    select ps.system_id into new.system_id from process_steps ps where ps.id = new.parent_id;
  end if;

  if new.system_id is null and new.service_id is not null then
    select sd.id into new.system_id
    from system_definitions sd
    where sd.kind = 'service' and sd.service_id = new.service_id and sd.archived_at is null;
  end if;

  return new;
end;
$$;

-- `update of` deliberately excludes the general case: this only needs to run
-- when the columns it reads change. Setting system_id explicitly to null on a
-- service-linked step re-stamps it — that is the intended behaviour (the step
-- does belong to that service's system), not an oversight.
drop trigger if exists trg_process_steps_stamp_system on process_steps;
create trigger trg_process_steps_stamp_system
  before insert or update of service_id, parent_id, system_id on process_steps
  for each row execute function public.tg_process_steps_stamp_system();

-- One-time backfill for rows already written without system_id.
update process_steps ps
set system_id = sd.id
from system_definitions sd
where sd.kind = 'service'
  and sd.archived_at is null
  and sd.service_id = ps.service_id
  and ps.system_id is null;

update process_steps child
set system_id = parent.system_id
from process_steps parent
where child.parent_id = parent.id
  and child.system_id is null
  and parent.system_id is not null;
