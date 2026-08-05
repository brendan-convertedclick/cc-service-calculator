-- 0107_system_edges_positions.sql
-- Apply via mcp__cc-supabase__apply_migration (name: system_edges_positions)
--
-- Phase 6: the canvas. Edges connect process_steps within a system; blocks
-- persist their dragged position. Cycles are permitted (loops are real in
-- marketing systems) — no cycle check.

create table system_edges (
  id             uuid primary key default gen_random_uuid(),
  system_id      uuid not null references system_definitions(id) on delete cascade,
  source_step_id uuid not null references process_steps(id) on delete cascade,
  target_step_id uuid not null references process_steps(id) on delete cascade,
  label          text,
  created_at     timestamptz not null default now(),
  unique (source_step_id, target_step_id)
);

create index system_edges_system_idx on system_edges(system_id);

alter table process_steps add column pos_x int, add column pos_y int;

-- RLS: authenticated read, admin/owner write. Two-policy pattern from
-- 0106_system_revisions (the corrected house pattern — both `to authenticated`),
-- not 0105's original single wide-open policy.
alter table system_edges enable row level security;

create policy system_edges_authed_read on system_edges
  for select to authenticated using (true);

create policy system_edges_admin_all on system_edges
  for all to authenticated
  using (current_team_member_role() in ('admin','owner'))
  with check (current_team_member_role() in ('admin','owner'));

create view system_handoffs as
select e.*, true as is_handoff
from system_edges e
join process_steps a on a.id = e.source_step_id
join process_steps b on b.id = e.target_step_id
where a.department_id is distinct from b.department_id;
