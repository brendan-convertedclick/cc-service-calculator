-- Retainers are recurring monthly projects. Flag existing retainer rows so the
-- UI (Recurrence card, project metrics) reflects it. Provisioning still runs
-- through provision-retainer-period — create-recurring-tasks excludes
-- engagement_type='retainer', so flipping the flag cannot double-provision.
-- Deploy the guarded create-recurring-tasks BEFORE applying this migration.
update public.projects
set is_recurring = true,
    recurrence_interval = coalesce(recurrence_interval, 'monthly'),
    recurrence_start = coalesce(recurrence_start, started_at::date)
where engagement_type = 'retainer';

-- Retainers carry the current period's month-end due date; the monthly
-- roll-forward cron advances it from here on. Only fill blanks — a manually
-- set due date wins until the next cron run.
update public.projects
set due_date = date_trunc('month', now()) + interval '1 month' - interval '1 day'
where engagement_type = 'retainer'
  and status <> 'archived'
  and due_date is null;
