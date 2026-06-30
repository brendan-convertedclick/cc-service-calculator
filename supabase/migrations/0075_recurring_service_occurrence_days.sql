-- Per-occurrence custom start/due days for recurring services.
--
-- Each entry is a day-of-month (1–31) indexed to match occurrence_labels — so
-- occurrence i uses occurrence_start_days[i] / occurrence_due_days[i]. Because
-- retainers re-provision every month, storing a day-of-month (not an absolute
-- date) makes the customization repeat automatically each period. A null/absent
-- entry falls back to the auto-computed default (monthly tasks span 1st → last
-- day; other cadences use their planned occurrence date).

alter table retainer_recurring_services
  add column if not exists occurrence_start_days int[] not null default '{}',
  add column if not exists occurrence_due_days   int[] not null default '{}';

comment on column retainer_recurring_services.occurrence_start_days is
  'Per-occurrence start day-of-month (1–31), indexed like occurrence_labels. Empty/0 = auto.';
comment on column retainer_recurring_services.occurrence_due_days is
  'Per-occurrence due day-of-month (1–31), indexed like occurrence_labels. Empty/0 = auto.';
