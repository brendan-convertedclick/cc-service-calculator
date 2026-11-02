-- 0203_recurring_content_month_offset.sql
-- Apply via mcp__cc-supabase__apply_migration (name: recurring_content_month_offset)
--
-- Social posts are made months before they go out, so a task provisioned in
-- November is for January's or February's posts. Lisa (2026-11-02): put the
-- content month in the task name, it confuses the team otherwise. The lead
-- differs per retainer, so it lives on the recurring service. Null = no month.
alter table public.retainer_recurring_services
  add column if not exists content_month_offset smallint
    check (content_month_offset between 0 and 12);

comment on column public.retainer_recurring_services.content_month_offset is
  'Months between the provisioning period and the month the work is for. Set = the task name carries that month ("January 2027"). Null = no month in the name.';
