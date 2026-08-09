-- A policy and a process attach to nothing: a policy is a rule, a process
-- spans services by definition. Both get a linkless arm on the 0106 check,
-- same as 'reference'.

alter table system_definitions drop constraint system_def_kind_link;

alter table system_definitions add constraint system_def_kind_link check (
  (kind = 'service'   and service_id is not null)           or
  (kind = 'recurring' and recurring_service_id is not null) or
  (kind = 'internal'  and time_category_id is not null)     or
  (kind = 'reference') or
  (kind = 'policy')    or
  (kind = 'process')
);
