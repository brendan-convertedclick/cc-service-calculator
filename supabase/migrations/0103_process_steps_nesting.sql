-- 0103_process_steps_nesting.sql
-- Apply via mcp__cc-supabase__apply_migration (name: process_steps_nesting)
--
-- Nested steps: process_steps can now parent other process_steps (one level
-- deep in practice, no depth limit enforced). A sub-step (parent_id set)
-- materialises as a ClickUp checklist item on its parent step's task, and
-- carries no hours of its own — the check constraint enforces that.
-- Absorbs services.checklist_items into the step hierarchy (see data
-- migration below); the column is deprecated, not dropped.

alter table process_steps
  add column parent_id uuid references process_steps(id) on delete cascade;

create index process_steps_parent_idx on process_steps(parent_id);

-- the old unique(service_id, ordinal) cannot survive nesting: a parent step
-- and its sub-steps now share ordinal ranges scoped per-parent instead.
alter table process_steps drop constraint if exists process_steps_service_id_ordinal_key;

create unique index process_steps_ordinal_idx
  on process_steps (coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    coalesce(parent_id,  '00000000-0000-0000-0000-000000000000'::uuid),
                    ordinal);

-- sub-steps carry no hours of their own (their parent step's hours already
-- cover the work; hours would otherwise double-count in the allocation view)
alter table process_steps
  add constraint process_steps_substep_no_hours
  check (parent_id is null or estimated_hours is null);

-- data migration: services.checklist_items -> sub-steps under each service's
-- last top-level step (highest ordinal, parent_id is null). Services with
-- checklist items but no top-level step to parent to are skipped. Guarded by
-- the unique index above so a re-run is a no-op, not a duplicate insert.
insert into process_steps (service_id, parent_id, ordinal, title)
select s.id, last_step.id, item.ordinal, item.title
from services s
cross join lateral unnest(s.checklist_items) with ordinality as item(title, ordinal)
join lateral (
  select ps.id
  from process_steps ps
  where ps.service_id = s.id and ps.parent_id is null
  order by ps.ordinal desc
  limit 1
) last_step on true
where s.checklist_items is not null and array_length(s.checklist_items, 1) > 0
on conflict (coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
             coalesce(parent_id,  '00000000-0000-0000-0000-000000000000'::uuid),
             ordinal) do nothing;

comment on column services.checklist_items is 'DEPRECATED (0103): superseded by nested
process_steps. Not dropped — retainer_recurring_services.checklist_items and ad-hoc items
still use the same shape.';

-- service_allocation_resolved: recreate in full, only change is the added
-- "parent_id is null" guard in step_sums so sub-steps (which carry no hours
-- anyway) can never be double-counted.
create or replace view service_allocation_resolved as
 WITH RECURSIVE step_sums AS (
         SELECT process_steps.service_id,
            process_steps.department_id,
            sum(process_steps.estimated_hours) AS hours
           FROM process_steps
          WHERE process_steps.department_id IS NOT NULL AND process_steps.estimated_hours IS NOT NULL AND process_steps.parent_id IS NULL
          GROUP BY process_steps.service_id, process_steps.department_id
        ), tree AS (
         SELECT s.id AS root_id,
            s.id AS node_id,
            1 AS quantity,
            0 AS depth
           FROM services s
        UNION ALL
         SELECT t.root_id,
            sc.child_id,
            t.quantity * sc.quantity AS int4,
            t.depth + 1
           FROM tree t
             JOIN service_children sc ON sc.parent_id = t.node_id
          WHERE NOT (EXISTS ( SELECT 1
                   FROM step_sums ss
                  WHERE ss.service_id = t.node_id)) AND t.depth < 10
        ), derived AS (
         SELECT t.root_id AS service_id,
            ss.department_id,
            sum(ss.hours * t.quantity::numeric) AS hours
           FROM tree t
             JOIN step_sums ss ON ss.service_id = t.node_id
          WHERE NOT (EXISTS ( SELECT 1
                   FROM step_sums x
                  WHERE x.service_id = t.root_id)) OR t.node_id = t.root_id
          GROUP BY t.root_id, ss.department_id
        ), derived_plus_price AS (
         SELECT d.service_id,
            d.department_id,
            d.hours,
            dep.hourly_rate_cents,
            s.sell_price_cents,
            s.pricing_model
           FROM derived d
             JOIN services s ON s.id = d.service_id
             JOIN departments dep ON dep.id = d.department_id
        ), services_with_derived AS (
         SELECT DISTINCT derived.service_id
           FROM derived
        ), rule_fallback AS (
         SELECT s.id AS service_id,
            ra.department_id,
                CASE
                    WHEN s.pricing_model = 'percentage'::text OR s.sell_price_cents <= 0 OR dep.hourly_rate_cents <= 0 THEN 0::numeric
                    ELSE round(ra.pct * s.sell_price_cents::numeric / dep.hourly_rate_cents::numeric / 100.0, 2)
                END AS hours,
            dep.hourly_rate_cents,
            s.sell_price_cents,
            s.pricing_model,
            ra.pct
           FROM services s
             JOIN rule_allocations ra ON ra.rule_id = s.rule_id
             JOIN departments dep ON dep.id = ra.department_id
          WHERE s.rule_id IS NOT NULL AND NOT (EXISTS ( SELECT 1
                   FROM services_with_derived swd
                  WHERE swd.service_id = s.id))
        )
 SELECT derived_plus_price.service_id,
    derived_plus_price.department_id,
        CASE
            WHEN derived_plus_price.pricing_model = 'percentage'::text OR derived_plus_price.sell_price_cents <= 0 THEN NULL::numeric
            ELSE round(derived_plus_price.hours * derived_plus_price.hourly_rate_cents::numeric * 100.0 / derived_plus_price.sell_price_cents::numeric, 2)
        END AS pct,
        CASE
            WHEN derived_plus_price.pricing_model = 'percentage'::text THEN 0
            ELSE round(derived_plus_price.hours * derived_plus_price.hourly_rate_cents::numeric)::integer
        END AS price_share_cents,
    derived_plus_price.hours
   FROM derived_plus_price
UNION ALL
 SELECT rule_fallback.service_id,
    rule_fallback.department_id,
    rule_fallback.pct,
        CASE
            WHEN rule_fallback.pricing_model = 'percentage'::text THEN 0
            ELSE round(rule_fallback.hours * rule_fallback.hourly_rate_cents::numeric)::integer
        END AS price_share_cents,
    rule_fallback.hours
   FROM rule_fallback;
