-- Staff picks a Work Stream + Status per meeting on the /staff Internal
-- Meeting form, instead of only inheriting the linked project's
-- clickup_work_stream_override. Nullable — meetings with no override keep
-- falling back to the project override (Work Stream) or the list default
-- (Status), exactly as before.

alter table internal_meetings
  add column if not exists work_stream_override text,
  add column if not exists clickup_status_override text;

comment on column internal_meetings.work_stream_override is
  'Staff-picked ClickUp "Work Stream" dropdown value for this meeting''s task. Takes priority over projects.clickup_work_stream_override when set.';
comment on column internal_meetings.clickup_status_override is
  'Staff-picked ClickUp status for this meeting''s task. Left null to use the list default (status is otherwise omitted on create — see manage-internal-meeting).';
