-- 0084_brief_task_status.sql
--
-- Progress % on brief rows: persist each brief-created ClickUp task's last
-- synced status so the Briefs list can show how far the handed-off work is.
-- Populated by sync-clickup-actuals (30-min cron + "Sync now").

alter table public.briefs
  add column if not exists clickup_task_status text,
  add column if not exists clickup_status_synced_at timestamptz;

comment on column public.briefs.clickup_task_status is
  'Last synced ClickUp status of the quick-briefed task (briefs.clickup_task_id). Lowercase ClickUp status string.';

alter table public.placement_tasks
  add column if not exists clickup_status text,
  add column if not exists clickup_status_synced_at timestamptz;

comment on column public.placement_tasks.clickup_status is
  'Last synced ClickUp status of the scheduled task (placement_tasks.clickup_task_id). Lowercase ClickUp status string.';
