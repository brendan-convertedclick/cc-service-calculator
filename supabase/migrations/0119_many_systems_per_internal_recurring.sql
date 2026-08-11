-- 0119_many_systems_per_internal_recurring.sql
-- Apply via mcp__cc-supabase__apply_migration (name: many_systems_per_internal_recurring)
--
-- 0107 gave every attachment a partial unique index, so a time category could
-- back exactly one live system. That's wrong for internal work: "Client
-- Meetings" is a pre-meeting procedure, an in-meeting one and a post-meeting
-- one, all under Sales / BD. Same for recurring services.
--
-- kind='service' deliberately KEEPS its 1:1 index: push-to-clickup resolves
-- service -> system when materialising a quote line (serviceIdBySystemId /
-- publishedBodyByServiceId), and useSystemRevisions falls back to
-- service_id for steps. Lifting it needs a product call on which procedure a
-- quoted service pushes — out of scope here.

drop index if exists system_definitions_one_per_internal_idx;
drop index if exists system_definitions_one_per_recurring_idx;
