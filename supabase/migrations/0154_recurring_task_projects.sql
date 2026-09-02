-- 0154_recurring_task_projects.sql
--
-- Applied 2026-09-02 (name: recurring_task_projects).
--
-- A recurring task is not a retainer.
--
-- Lisa, 2026-09-02: "I want to keep Retainers strictly to invoiced items, so
-- that is all we track against. What is invoiced per month vs the work getting
-- done... Is it possible to have tasks that recur monthly for example website
-- plugin updates, reports etc. that get scheduled every month but does not live
-- in retainers page?"
--
-- Thirteen of the thirty-six retainer projects are that shape: a plugin update,
-- a monthly report, a standing meeting. They are half an hour each, they repeat
-- for ever, and several carry no fee at all — so they add rows and planned
-- hours to a page whose job is to say whether a client's retainer is being
-- serviced, and they answer a different question.
--
-- They stay projects with engagement_type='retainer', which is deliberate: the
-- provisioner selects on that, and the whole point is that these keep being
-- scheduled every month. Only the reporting changes.
alter table public.projects
  add column if not exists is_recurring_task boolean not null default false;

comment on column public.projects.is_recurring_task is
  'A standing monthly task (plugin updates, a report, a meeting) rather than a retainer engagement. Still provisioned every month; shown on the Retainers page under its own tab and kept out of the retainer book.';

update public.projects set is_recurring_task = true
 where engagement_type = 'retainer'
   and status <> 'archived'
   and id in (
     '32266103-69b8-4a16-8431-1a97c5e37429', -- Dovetail RSA Google Ads Report
     'bc134e76-5023-4103-9b09-12534af197d7', -- Dovetail RSA Website Plugin
     '3fb65ab9-9f41-44ce-a67b-eeb28e3e734b', -- Kings College Paid Media Report
     '24ffc0b0-16fc-4773-bb19-4277dac65cf7', -- Kings College Website Plugin
     'a2db48f3-981e-4c00-b205-a8939df63f1b', -- Little Flock School Website Plugin
     'e9d3fa23-e55d-48b3-9492-0be5139459f5', -- OracleMed Website Plugin
     '309ac202-604e-4aa8-88d3-22b0ade37660', -- Pimms Website Maintenance / Plugin
     '8ba5e590-02ac-4e17-a9ff-9d524cf6b1eb', -- Trellidor OMD x CC regroup
     '6f51bbc7-5b78-4d69-ac9d-88f2d3dc67f0', -- Trellidor Bi-Weekly Meetings
     'cb35e630-36b3-47e0-82c6-adb19169c795', -- Trellidor Monthly Reporting
     '26c830ae-7658-4d67-9a34-15f1fe70ab5e', -- Trellidor Website Plugin
     '6367ca30-f61f-4266-8456-5d636963874a', -- Trellidor UK Paid Media Report
     '07aac5a8-b603-4678-af4b-6e5b779ea723'  -- Trellidor UK Website Plugin
   );
