-- 0187_one_open_day_row.sql
--
-- One "Open day" row, not one per term. The month column already says which
-- open day a task belongs to, so a Term 1 row and a Term 3 row only split the
-- same work in two. 0184 gave school tasks the term; this puts them back on
-- the template's single row.
--
-- Kings College's Year results had the same split (Open Day · Term 1 / Term
-- 3). Both rows were empty (no entries, no task links) when this ran, so the
-- first becomes "Open day" and the second is removed, keeping the planner and
-- Year results on the same rows.

update public.school_tasks
   set plan_row = 'Open day'
 where plan_row in ('Open Day · Term 1', 'Open Day · Term 3');

update public.results_rows r
   set name = 'Open day'
 where r.name = 'Open Day · Term 1';

delete from public.results_rows r
 where r.name = 'Open Day · Term 3'
   and not exists (select 1 from public.results_entries e where e.row_id = r.id)
   and not exists (select 1 from public.results_task_links l where l.row_id = r.id);
