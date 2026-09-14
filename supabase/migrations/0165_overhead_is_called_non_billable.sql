-- "Overhead" was accounting's word for it and nobody on the team used it, so
-- the Live tasks page offered five categories under a heading that had to be
-- explained every time. The thing they describe is time no client pays for,
-- which is what it is now called.
--
-- Only the display labels move. `task_groups.label_key` stays 'overhead' and
-- every id is untouched, so anything keyed on either keeps working. The list
-- name matcher in _shared/meeting-clickup.ts learns the new word alongside
-- the old one, because ClickUp lists already created as "Overhead" keep that
-- name until somebody renames them over there.

update task_groups
   set label = 'Non-Billable',
       description = 'Member-level time no client pays for'
 where label_key = 'overhead';

update baseline_lists
   set label = 'Non-Billable'
 where group_id = (select id from task_groups where label_key = 'overhead');
