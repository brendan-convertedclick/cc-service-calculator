-- 0153_project_revenue_source.sql
--
-- Applied 2026-09-02 (name: project_revenue_source).
--
-- What pays for a retainer that carries no fee.
--
-- Lisa, 2026-09-02: "Some retainer line items are really just tasks with no
-- invoice attached (e.g. plugin updates). Move these out of Retainer and into
-- the correct category/revenue source so they stop distorting the retainer
-- numbers."
--
-- Five of Trellidor's retainers carry an hours target and a zero fee. They are
-- real, recurring, monthly work — so deleting them would lose the commitment —
-- but they add 10 planned hours a month that no invoice covers, which is what
-- distorts the numbers. A zero fee already says "no revenue"; what it cannot
-- say is WHY, and the why is different for each one: hosting covers the plugin
-- updates, the OMD regroup is invoiced ad hoc, the meetings and the report are
-- simply not charged.
--
-- Free text rather than an enum: there are five rows, the answers are all
-- different sentences, and an enum would need a migration the first time
-- someone had a sixth kind of answer.
alter table public.projects
  add column if not exists revenue_source text;

comment on column public.projects.revenue_source is
  'For work with no fee of its own: what actually pays for it. Shown on the Retainers page against any retainer whose monthly fee is zero, which is counted apart from the retainer book.';

update public.projects set revenue_source = 'Covered by the hosting fee'
 where name ilike '%plugin%update%' and coalesce(retainer_monthly_fee_cents, 0) = 0;

update public.projects set revenue_source = 'Invoiced ad hoc'
 where name ilike '%OMD x CC%' and coalesce(retainer_monthly_fee_cents, 0) = 0;

update public.projects set revenue_source = 'Not charged'
 where (name ilike '%bi - weekly meeting%' or name ilike '%monthly reporting%')
   and coalesce(retainer_monthly_fee_cents, 0) = 0;
