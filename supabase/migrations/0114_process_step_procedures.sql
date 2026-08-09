-- 0114_process_step_procedures.sql
-- Apply via mcp__cc-supabase__apply_migration (name: process_step_procedures)
--
-- Phase: the process layer. A block on a kind='process' canvas describes a
-- stage of the flow and carries 0..N procedures.
--
-- Zero is the load-bearing case, not the empty one: a block with a stated
-- outcome and nothing attached is a *visible gap* — the flow needs this and
-- nobody has written the system for it yet. That gap is what the canvas is
-- for, and it's the input the procedure wizard triages.
--
-- Many-to-many rather than a links_system_id column on process_steps: one
-- block ("Google Ads") routinely carries several procedures.
--
-- No FK-level guard against attaching a process to a process — a check
-- constraint can't see the target row's kind, and the picker only offers
-- procedure-layer systems. Add a trigger if that ever leaks.

create table process_step_procedures (
  id         uuid primary key default gen_random_uuid(),
  step_id    uuid not null references process_steps(id) on delete cascade,
  system_id  uuid not null references system_definitions(id) on delete cascade,
  ordinal    int not null default 0,
  created_at timestamptz not null default now(),
  unique (step_id, system_id)
);

create index process_step_procedures_step_idx on process_step_procedures(step_id);
create index process_step_procedures_system_idx on process_step_procedures(system_id);

-- RLS: authenticated read, admin/owner write — the two-policy pattern from
-- 0107_system_revisions / 0108_system_edges_positions.
alter table process_step_procedures enable row level security;

create policy process_step_procedures_authed_read on process_step_procedures
  for select to authenticated using (true);

create policy process_step_procedures_admin_all on process_step_procedures
  for all to authenticated
  using (current_team_member_role() in ('admin','owner'))
  with check (current_team_member_role() in ('admin','owner'));

comment on table process_step_procedures is
  'Procedures attached to a process-canvas block. 0..N per block; zero means an unsystemised stage.';
