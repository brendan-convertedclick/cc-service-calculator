-- Roll-up: collapse a recurring service's monthly occurrences into ONE task per
-- assignee (spanning the period, holding the whole month's points/hours) instead
-- of one task per occurrence. For high-frequency ceremonies (daily standup,
-- weekly status) this cuts the provisioned task count dramatically.
--
-- Off by default — set per service in the retainer services editor. When on, the
-- provisioner emits a single monthly-style task per assignee (see
-- provision-retainer-period).

alter table retainer_recurring_services
  add column if not exists roll_up_monthly boolean not null default false;

comment on column retainer_recurring_services.roll_up_monthly is
  'When true, provision one monthly task per assignee holding the whole period''s points/hours, instead of one task per occurrence.';
