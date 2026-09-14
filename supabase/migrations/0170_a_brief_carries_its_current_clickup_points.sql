-- 0170_a_brief_carries_its_current_clickup_points.sql
-- Apply via mcp__cc-supabase__apply_migration (name: a_brief_carries_its_current_clickup_points)
--
-- briefs.original_points is the estimate frozen at briefing time, and it has
-- to stay frozen: over_budget is measured against it. But ClickUp's points
-- dashboard sums the CURRENT points on the task, and people edit points after
-- briefing (Lisa's "Create Email Templates" went 2 → 6). The per-task diff on
-- 2026-09-14 found every remaining August gap bar one was exactly this. So a
-- brief now also carries the live value, refreshed by the sync every time it
-- reads the task, and the capacity page reads that.

alter table public.briefs
  add column if not exists clickup_points numeric;

comment on column public.briefs.clickup_points is
  'Sprint points on the ClickUp task as last synced. original_points stays the frozen estimate for over_budget; this is what ClickUp currently says and what the capacity page values the task at.';
