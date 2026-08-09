-- Phase: systems — Policies and Processes join Procedures under one nav.
--
-- Three sections, one table. `kind` carries the distinction rather than a new
-- orthogonal `layer` column, per the recorded process-layer decision: a
-- Process is a system_definitions row with kind='process' whose steps will
-- later point at child procedures (process_steps.links_system_id). A Policy is
-- its peer — a rule, not a level: zero steps, attaches to nothing.
--
-- Deliberately NOT kind='reference': that value is user-facing in the Kind
-- filter rail and means "documented, unattached procedure", which is a
-- different thing from a policy.
--
-- Split from 0113 because Postgres refuses to use an enum value added in the
-- same transaction — the constraint rewrite has to be its own migration.

alter type system_kind add value if not exists 'policy';
alter type system_kind add value if not exists 'process';
