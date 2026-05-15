-- supabase/migrations/0050_live_tasks_billable.sql
--
-- Live-task billing flag. time_categories.billable is the default for
-- every (member × client × template) cell; ongoing_tasks.billable is a
-- nullable per-row override. NULL on ongoing_tasks => inherit from the
-- category. We mirror this flag to ClickUp's native billable toggle on
-- the task at provision time so ClickUp and our DB stay in sync.

alter table public.time_categories
  add column if not exists billable boolean not null default false;

comment on column public.time_categories.billable is
  'Default billable state for tasks provisioned from this template. '
  'Delivery-group templates are typically true; Overhead/Admin/Meetings false.';

alter table public.ongoing_tasks
  add column if not exists billable boolean;

comment on column public.ongoing_tasks.billable is
  'Per-task override of time_categories.billable. NULL inherits from the '
  'category. Use only for genuine exceptions (e.g. a normally-billable '
  'category being used as overhead for a specific member on a specific client).';

-- Backfill: every template in the Delivery group is billable. Others stay false.
update public.time_categories
   set billable = true
 where group_id = (select id from public.task_groups where label_key = 'delivery');
