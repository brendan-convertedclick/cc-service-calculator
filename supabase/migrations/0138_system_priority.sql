-- 0138: the priority list.
--
-- Which procedures the team is actually working on next. Timestamp rather than
-- a boolean, matching archived_at: null means "not on the list", and the value
-- gives order-added for free if the list ever needs to be ordered.
alter table system_definitions add column if not exists priority_at timestamptz;

comment on column system_definitions.priority_at is
  'When this system was put on the priority list. Null = not on it. Shared across the team, like the rest of the library.';
