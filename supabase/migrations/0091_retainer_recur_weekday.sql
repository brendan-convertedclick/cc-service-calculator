-- Weekday-anchored recurrence for retainer services.
--
-- Some recurring services must land on a specific weekday every week (e.g.
-- "Monday Status" → one task per Monday in the month, which is 4 or 5 depending
-- on the month). The existing cadence/occurrences model can't express that: it
-- strides ~7 days from the 1st and uses a fixed occurrence count. When
-- recur_weekday is set (0=Sunday … 6=Saturday), the provisioner enumerates every
-- occurrence of that weekday in the billing period instead.
alter table retainer_recurring_services
  add column if not exists recur_weekday smallint
  check (recur_weekday is null or recur_weekday between 0 and 6);

comment on column retainer_recurring_services.recur_weekday is
  'When set (0=Sun..6=Sat), provision one task per occurrence of this weekday in the period, overriding cadence/occurrences_per_month.';
