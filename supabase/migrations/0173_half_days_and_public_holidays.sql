-- 0173_half_days_and_public_holidays.sql
-- Apply via mcp__cc-supabase__apply_migration (name: half_days_and_public_holidays)
--
-- Lisa, 2026-09-15: "preload South African public holidays and also enable
-- 1/2 days". A day off is now a fraction of a day (1 or 0.5) and the
-- capacity maths subtracts fraction × 7h. Public holidays are seeded as
-- kind = 'holiday' for every current team member for 2026 and 2027.
--
-- Public Holidays Act 36 of 1994, with the Sunday rule (a holiday on a
-- Sunday moves to the Monday). Saturday holidays get no substitute and are
-- not seeded: they were never a working day. Easter 2026 is 5 April, 2027
-- is 28 March.
--
-- ponytail: holidays are per-person rows, so a team member added later will
-- not carry them; re-run the seed block for them, or promote this to a
-- public_holidays table when the team grows.

alter table public.team_days_off
  add column if not exists fraction numeric(2,1) not null default 1
    check (fraction in (0.5, 1));

comment on column public.team_days_off.fraction is
  '1 = the whole day, 0.5 = half a day. Capacity subtracts fraction × HOURS_PER_WORKING_DAY.';

with holidays (day, name) as (
  values
    -- 2026
    (date '2026-01-01', 'New Year''s Day'),
    -- 21 Mar 2026 is a Saturday: no substitute
    (date '2026-04-03', 'Good Friday'),
    (date '2026-04-06', 'Family Day'),
    (date '2026-04-27', 'Freedom Day'),
    (date '2026-05-01', 'Workers'' Day'),
    (date '2026-06-16', 'Youth Day'),
    (date '2026-08-10', 'National Women''s Day (observed)'),
    (date '2026-09-24', 'Heritage Day'),
    (date '2026-12-16', 'Day of Reconciliation'),
    (date '2026-12-25', 'Christmas Day'),
    -- 26 Dec 2026 is a Saturday: no substitute
    -- 2027
    (date '2027-01-01', 'New Year''s Day'),
    (date '2027-03-22', 'Human Rights Day (observed)'),
    (date '2027-03-26', 'Good Friday'),
    (date '2027-03-29', 'Family Day'),
    (date '2027-04-27', 'Freedom Day'),
    -- 1 May 2027 is a Saturday: no substitute
    (date '2027-06-16', 'Youth Day'),
    (date '2027-08-09', 'National Women''s Day'),
    (date '2027-09-24', 'Heritage Day'),
    (date '2027-12-16', 'Day of Reconciliation'),
    -- 25 Dec 2027 is a Saturday: no substitute
    (date '2027-12-27', 'Day of Goodwill (observed)')
)
insert into public.team_days_off (team_member_id, day, kind, note, fraction)
select tm.id, h.day, 'holiday', h.name, 1
from holidays h
cross join public.team_members tm
where tm.archived_at is null
on conflict (team_member_id, day) do nothing;
