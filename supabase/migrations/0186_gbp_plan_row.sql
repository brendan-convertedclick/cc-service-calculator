-- 0186_gbp_plan_row.sql
--
-- Google Business Profile (formerly GMB) is its own row under Social media on
-- the planner, not part of the group-wide "General" row. Template and school
-- tasks move together so new years inherit it (0184's trigger).

update public.pipeline_template_tasks
   set plan_row = 'Google Business Profile'
 where plan_group = 'Social media'
   and label in ('Google Business Profile post published', 'Business Profile access granted');

update public.school_tasks
   set plan_row = 'Google Business Profile'
 where plan_group = 'Social media'
   and label in ('Google Business Profile post published', 'Business Profile access granted');
