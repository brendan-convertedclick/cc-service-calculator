-- An approver can approve a staff brief at a different time than was asked.
-- sprint_points stays what the submitter asked for; approved_points is what
-- went to ClickUp. Null means approved as asked. Kept apart because the gap
-- between the two is the conversation about efficiency, and overwriting the
-- ask would erase it.
alter table staff_briefs
  add column if not exists approved_points numeric(5,2)
    check (approved_points > 0);
