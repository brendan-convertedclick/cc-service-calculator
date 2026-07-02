-- Retainer-level ClickUp Work Stream override.
--
-- When set, every task provisioned for this retainer uses this Work Stream
-- option, overriding the per-service / department mapping. e.g. an Admin
-- retainer where every task should read Work Stream = Admin regardless of which
-- department a given service usually rolls up to. See provision-retainer-period
-- buildCustomFields (project override wins over service/department).

alter table projects
  add column if not exists clickup_work_stream_override text;

comment on column projects.clickup_work_stream_override is
  'When set, every provisioned task for this retainer uses this ClickUp Work Stream option, overriding the per-service/department mapping.';
