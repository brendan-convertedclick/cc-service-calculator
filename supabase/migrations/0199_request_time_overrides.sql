-- Revisions and extensions get the same asked/approved split staff briefs got
-- in 0198. The ask is never overwritten; the approved figure sits beside it
-- and is null when it was approved as asked.

-- A revision is new work, so it now states its time like a brief does. Null
-- only on rows from before this column existed.
alter table revision_requests
  add column if not exists sprint_points numeric(5,2) check (sprint_points > 0),
  add column if not exists approved_points numeric(5,2) check (approved_points > 0);

-- The extra time actually granted. Written on the admin leg when an owner-tier
-- request is trimmed before it goes up, so the owner signs off the figure the
-- admin chose. Greater than zero: refusing the time is a reject, not a zero.
alter table extension_requests
  add column if not exists approved_extra_points numeric(5,2) check (approved_extra_points > 0);
