-- 0014_drop_service_allocation_overrides.sql
-- Apply via mcp__cc-supabase__apply_migration (name: drop_service_allocation_overrides)
--
-- The table was deprecated in 0003 (its trigger dropped, view rewritten to
-- read from process_steps instead). One release cycle has passed; safe to
-- drop. Frontend dead query is removed in the same change set.

drop table if exists public.service_allocation_overrides;
