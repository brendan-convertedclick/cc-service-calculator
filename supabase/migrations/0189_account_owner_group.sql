-- 0189_account_owner_group.sql
--
-- The account owner's own work gets its own planner group, split out of
-- "Running the account": planning the year and the renewal (Year planning),
-- the relationship with the school (Client relationship) and what we report
-- to it (Reporting). Running the account keeps the operational rows: the
-- pipeline and tracker, reviews and reputation, site and search.
-- Template and school tasks move together, as in 0184/0188.

update public.pipeline_template_tasks
   set plan_group = 'Account owner'
 where plan_group = 'Running the account'
   and plan_row in ('Year planning', 'Client relationship', 'Reporting');

update public.school_tasks
   set plan_group = 'Account owner'
 where plan_group = 'Running the account'
   and plan_row in ('Year planning', 'Client relationship', 'Reporting');
