-- Operator override: manually flag a late delivery as client-caused, for when a
-- task didn't pass through the "waiting on client" status but the delay was
-- genuinely the client's. Feeds the same client-vs-internal attribution as the
-- automatic client_wait_ms signal.

alter table public.briefs
  add column if not exists client_delay_manual boolean not null default false;

comment on column public.briefs.client_delay_manual is 'Operator override: manually flags a late delivery as client-caused, even when the task did not pass through the "waiting on client" status. Feeds the same client-vs-internal attribution as client_wait_ms.';
