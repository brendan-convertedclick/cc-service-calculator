-- 0191_remove_meta_ads.sql
--
-- We are not running Meta ads. Paid media loses its Meta row and the work in
-- it, in the template and both schools, and the open day campaign wording
-- stops promising Meta. When this ran, none of the removed tasks had a brief,
-- a client ask or a Year results link, and Kings College's "Meta ads" results
-- row held no entries; the deletes below still refuse anything that does.
-- Organic Facebook (the web banner and cover, Organic social) is unaffected.

delete from public.school_tasks t
 where t.plan_group = 'Paid media' and t.plan_row = 'Meta ads'
   and t.brief_id is null and t.client_approval_id is null
   and not exists (select 1 from public.results_task_links l where l.school_task_id = t.id);

delete from public.pipeline_template_tasks
 where plan_group = 'Paid media' and plan_row = 'Meta ads';

update public.school_tasks set description = 'The open day campaign goes live on PMax. Live on the T-minus schedule.'
 where label = 'Open day campaign live';
update public.pipeline_template_tasks set description = 'The open day campaign goes live on PMax. Live on the T-minus schedule.'
 where label = 'Open day campaign live';

update public.school_tasks set description = 'PMax campaigns built in Slate ahead of launch. Ready in Slate, not live.'
 where label = 'Open day campaigns built';
update public.pipeline_template_tasks set description = 'PMax campaigns built in Slate ahead of launch. Ready in Slate, not live.'
 where label = 'Open day campaigns built';

delete from public.results_rows r
 where r.name = 'Meta ads'
   and not exists (select 1 from public.results_entries e where e.row_id = r.id)
   and not exists (select 1 from public.results_task_links l where l.row_id = r.id);
