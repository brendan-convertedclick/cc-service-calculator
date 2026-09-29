-- 0188_merge_plan_rows.sql
--
-- Fewer, truer rows on the planner, applied to the template and both schools
-- together (0184's trigger copies plan_row from the template by label):
--
--   Campaigns › "Grade 8 · 2028 intake"  -> "Intake". A year baked into a
--       template row is wrong from the next year on.
--   Social media › General               -> "Organic social". The posts go
--       to every channel; per-channel rows (Instagram / Facebook / LinkedIn)
--       held nothing.
--   Events › General                     -> "Open day". Open day dates and the
--       school calendar are open day work.
--   Running the account › "Year setup" and "Annual review" -> "Year planning".
--
-- Kings College's Year results mirror it where the rows were empty (no
-- entries, no task links): Instagram becomes "Organic social", Facebook and
-- LinkedIn go, and the intake row is renamed. A row holding data is left.

update public.pipeline_template_tasks set plan_row = 'Intake' where plan_row = 'Grade 8 · 2028 intake';
update public.school_tasks            set plan_row = 'Intake' where plan_row = 'Grade 8 · 2028 intake';

update public.pipeline_template_tasks set plan_row = 'Organic social' where plan_group = 'Social media' and plan_row is null;
update public.school_tasks            set plan_row = 'Organic social' where plan_group = 'Social media' and plan_row is null;

update public.pipeline_template_tasks set plan_row = 'Open day' where plan_group = 'Events' and plan_row is null;
update public.school_tasks            set plan_row = 'Open day' where plan_group = 'Events' and plan_row is null;

update public.pipeline_template_tasks set plan_row = 'Year planning' where plan_row in ('Year setup', 'Annual review');
update public.school_tasks            set plan_row = 'Year planning' where plan_row in ('Year setup', 'Annual review');

update public.results_rows r set name = 'Intake'
 where r.name = 'Grade 8 · 2028 intake'
   and not exists (select 1 from public.results_entries e where e.row_id = r.id);

update public.results_rows r set name = 'Organic social'
 where r.name = 'Instagram'
   and not exists (select 1 from public.results_entries e where e.row_id = r.id)
   and not exists (select 1 from public.results_task_links l where l.row_id = r.id);

delete from public.results_rows r
 where r.name in ('Facebook', 'LinkedIn')
   and not exists (select 1 from public.results_entries e where e.row_id = r.id)
   and not exists (select 1 from public.results_task_links l where l.row_id = r.id);
